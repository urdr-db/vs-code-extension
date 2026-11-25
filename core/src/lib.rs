//! The checks the Urðr VS Code extension runs, compiled to WebAssembly.
//!
//! The extension works without an Urðr server: everything here runs on
//! the Urðr crates themselves, so a file passes or fails the same way in
//! VS Code as in the database.
//!
//! Every check is a conversation, as in Urðr Studio's offline validator:
//! the caller passes the text and every related file it has found so far
//! (`files`, by absolute URI); the answer lists the URIs the check needed
//! and was not given (`needed`); the caller reads those and asks again,
//! until nothing new is needed. The WebAssembly module never touches the
//! disk or the network itself, so the same module runs in desktop VS Code
//! and in the browser.
//!
//! Requests and answers are JSON, described on each function.

use std::cell::RefCell;
use std::collections::{BTreeSet, HashMap};

use serde_json::{Value, json};
use urdr_xq_analyze::{LibrarySource, ModuleResolver, StaticContext, analyze_program};
use urdr_xq_syntax::{Language, Version};

pub mod bindings;
pub mod outline;
pub mod transform;

/// One problem to show in the editor. Offsets are UTF-8 byte offsets in
/// the checked text; line and column count from 1, 0 when unknown.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Problem {
    /// The W3C error code, such as `XPST0003`.
    pub code: String,
    /// What is wrong, for people.
    pub message: String,
    /// Byte range in the checked text, when known.
    pub span: Option<(u32, u32)>,
    /// Line and column, when known (XSLT reports these).
    pub line: u32,
    /// See [`Problem::line`].
    pub column: u32,
    /// The URI of the file the problem is in, when it is not the checked
    /// text itself (an imported module).
    pub uri: Option<String>,
}

impl Problem {
    fn to_json(&self) -> Value {
        json!({
            "code": self.code,
            "message": self.message,
            "start": self.span.map(|s| s.0),
            "end": self.span.map(|s| s.1),
            "line": self.line,
            "column": self.column,
            "uri": self.uri,
        })
    }
}

/// The answer of a check: the problems found and the files still needed.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Answer {
    /// Problems, in the order found.
    pub problems: Vec<Problem>,
    /// Absolute URIs the check needed and was not given.
    pub needed: Vec<String>,
}

impl Answer {
    /// The answer as JSON: `{"problems": [...], "needed": [...]}`.
    #[must_use]
    pub fn to_json(&self) -> String {
        json!({
            "problems": self.problems.iter().map(Problem::to_json).collect::<Vec<_>>(),
            "needed": self.needed,
        })
        .to_string()
    }
}

/// A request to check a query or stylesheet.
#[derive(Debug, Clone, Default)]
pub struct Request {
    /// The text to check.
    pub text: String,
    /// Its absolute URI, such as `file:///edition/xslt/main.xsl`.
    pub uri: String,
    /// Related files' texts by absolute URI.
    pub files: HashMap<String, String>,
}

/// Reads a [`Request`] from JSON: `{"text", "uri", "files": {uri: text}}`.
///
/// # Errors
/// Why the JSON is not a request.
pub fn request_from_json(text: &str) -> Result<Request, String> {
    let v: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    let field = |k: &str| {
        v.get(k)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned()
    };
    let files = v
        .get("files")
        .and_then(Value::as_object)
        .map(|m| {
            m.iter()
                .filter_map(|(k, v)| v.as_str().map(|t| (k.clone(), t.to_owned())))
                .collect()
        })
        .unwrap_or_default();
    Ok(Request {
        text: field("text"),
        uri: field("uri"),
        files,
    })
}

/// Resolves `reference` against the absolute URI `base`, as RFC 3986 does
/// for the hierarchical URIs editors use (`file:`, `http(s):`, `untitled:`).
#[must_use]
pub fn resolve(base: &str, reference: &str) -> String {
    if reference.contains("://") || reference.starts_with("urn:") {
        return reference.to_owned();
    }
    let Some(scheme_end) = base.find("://").map(|i| i + 3) else {
        return reference.to_owned();
    };
    let authority_end = base[scheme_end..]
        .find('/')
        .map_or(base.len(), |i| scheme_end + i);
    if reference.starts_with('/') {
        return format!("{}{reference}", &base[..authority_end]);
    }
    let dir_end = base
        .rfind('/')
        .map_or(base.len(), |i| i + 1)
        .max(authority_end);
    let mut segments: Vec<&str> = base[authority_end..dir_end]
        .split('/')
        .filter(|s| !s.is_empty())
        .collect();
    for part in reference.split('/') {
        match part {
            "." | "" => {}
            ".." => {
                segments.pop();
            }
            p => segments.push(p),
        }
    }
    let trailing = if reference.ends_with('/') { "/" } else { "" };
    format!(
        "{}/{}{trailing}",
        &base[..authority_end],
        segments.join("/")
    )
}

/// Library modules for XQuery, from the files the caller passed. A
/// module it does not have is written down as needed.
#[derive(Debug)]
struct Libraries<'a> {
    files: &'a HashMap<String, String>,
    base: &'a str,
    needed: RefCell<BTreeSet<String>>,
}

impl ModuleResolver for Libraries<'_> {
    fn resolve(&self, namespace: &str, locations: &[String]) -> Vec<String> {
        self.library(namespace, locations, None)
            .unwrap_or_default()
            .into_iter()
            .map(|l| l.text)
            .collect()
    }

    fn library(
        &self,
        _namespace: &str,
        locations: &[String],
        base: Option<&str>,
    ) -> Result<Vec<LibrarySource>, String> {
        let base = base.unwrap_or(self.base);
        let mut found = Vec::new();
        for l in locations {
            let uri = resolve(base, l);
            match self.files.get(&uri) {
                Some(text) => found.push(LibrarySource {
                    text: text.clone(),
                    location: Some(uri.clone()),
                    base_uri: Some(uri),
                }),
                None => {
                    self.needed.borrow_mut().insert(uri);
                }
            }
        }
        Ok(found)
    }
}

/// Checks an XQuery main or library module: syntax and static errors,
/// including those in the library modules it imports.
#[must_use]
pub fn check_xquery(request: &Request) -> Answer {
    check_query(
        request,
        StaticContext::new(Language::XQuery, Version::default()),
    )
}

/// Checks an XPath expression (XPath 3.1).
#[must_use]
pub fn check_xpath(request: &Request) -> Answer {
    check_query(
        request,
        StaticContext::new(Language::XPath, Version::default()),
    )
}

fn check_query(request: &Request, mut context: StaticContext) -> Answer {
    context.base_uri = Some(request.uri.clone());
    let libraries = Libraries {
        files: &request.files,
        base: &request.uri,
        needed: RefCell::default(),
    };
    let result = analyze_program(&request.text, &context, &libraries);
    let needed: Vec<String> = libraries.needed.into_inner().into_iter().collect();
    let mut answer = Answer {
        problems: Vec::new(),
        needed: needed.clone(),
    };
    if let Err(e) = result {
        // A module not given yet is reported as needed, not as an error:
        // the caller reads it and checks again.
        if e.code() == "XQST0059" && !needed.is_empty() {
            return answer;
        }
        let span = e.span();
        // An error inside an imported module is shown on the import, with
        // the module's place in the message.
        let (span, message) = match (e.location(), e.import_span()) {
            (Some(place), Some(import)) => (
                Some((import.start, import.end)),
                format!("{place}: {}", e.message()),
            ),
            (Some(place), None) => (None, format!("{place}: {}", e.message())),
            (None, _) => (Some((span.start, span.end)), e.message().to_owned()),
        };
        answer.problems.push(Problem {
            code: e.code().to_owned(),
            message,
            span,
            line: 0,
            column: 0,
            uri: None,
        });
    }
    answer
}

/// Stylesheet modules from the files the caller passed.
#[derive(Debug)]
struct Modules<'a> {
    files: &'a HashMap<String, String>,
    needed: RefCell<BTreeSet<String>>,
}

impl urdr_xslt::ModuleLoader for Modules<'_> {
    fn load(&self, uri: &str) -> Result<Vec<u8>, String> {
        match self.files.get(uri) {
            Some(t) => Ok(t.clone().into_bytes()),
            None => {
                self.needed.borrow_mut().insert(uri.to_owned());
                Err(format!("{uri} has not been read yet"))
            }
        }
    }
}

/// Checks an XSLT stylesheet: its elements against XSLT 3.0, every
/// expression, pattern and type in it, and the modules it includes and
/// imports.
#[must_use]
pub fn check_xslt(request: &Request) -> Answer {
    let modules = Modules {
        files: &request.files,
        needed: RefCell::default(),
    };
    let options = urdr_xslt::CompileOptions {
        loader: Some(&modules),
        ..urdr_xslt::CompileOptions::default()
    };
    let result = urdr_xslt::read_stylesheet(request.text.as_bytes(), &request.uri, &options);
    let needed: Vec<String> = modules.needed.into_inner().into_iter().collect();
    let mut answer = Answer {
        problems: Vec::new(),
        needed: needed.clone(),
    };
    if let Err(e) = result {
        if !needed.is_empty() {
            return answer;
        }
        let (line, column, uri) = match e.location() {
            Some(l) => (
                l.line,
                l.column,
                (l.uri != request.uri).then(|| l.uri.clone()),
            ),
            None => (0, 0, None),
        };
        answer.problems.push(Problem {
            code: e.code().to_owned(),
            message: e.message().to_owned(),
            span: None,
            line,
            column,
            uri,
        });
    }
    answer
}

/// Checks an XML document against its schemas, exactly as Urðr's
/// `Validate` request and Studio's offline check do. `request` and the
/// answer are the JSON of [`urdr_validate_wasm`].
#[must_use]
pub fn validate_json(request: &str) -> String {
    match urdr_validate_wasm::request_from_json(request) {
        Ok(r) => urdr_validate_wasm::result_to_json(&urdr_validate_wasm::validate(&r)),
        Err(message) => urdr_validate_wasm::result_to_json(&Err(urdr_validate_wasm::Failure {
            code: "REQUEST",
            message: format!("the request is not usable: {message}"),
        })),
    }
}
