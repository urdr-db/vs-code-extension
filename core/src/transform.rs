//! Running an XSLT stylesheet over a document, for the extension's
//! "Transform with XSLT" command and its live preview.
//!
//! As every check here, a transformation is a conversation: the request
//! carries the stylesheet, the source and every related file read so far;
//! the answer lists what the stylesheet needed and was not given (modules
//! it includes or imports, documents `fn:doc` reads, texts
//! `fn:unparsed-text` reads). The caller reads those and runs it again.
//!
//! Request, as JSON:
//!
//! ```json
//! {"stylesheet": "file:///e/html.xsl", "stylesheetText": "<xsl:stylesheet ...",
//!  "source": "file:///e/letter.xml", "sourceText": "<TEI ...",
//!  "files": {"file:///e/common.xsl": "..."},
//!  "parameters": {"title": "Letters", "Q{urn:x}mode": "full"},
//!  "initialTemplate": null, "initialMode": null,
//!  "output": "file:///e/letter.html",
//!  "now": 1764096000000, "timezone": 60}
//! ```
//!
//! `now` is the time in milliseconds since 1970 and `timezone` the
//! offset from UTC in minutes: WebAssembly has no clock, so the caller
//! gives them for `fn:current-dateTime`. Parameter values are passed as
//! `xs:untypedAtomic`, as on a command line.
//!
//! Answer:
//!
//! ```json
//! {"results": [{"href": "", "text": "<html>...", "method": "html",
//!               "mediaType": "text/html"}],
//!  "messages": ["..."], "problems": [...], "needed": [...]}
//! ```
//!
//! The first result is the principal one (its `href` is empty); the
//! others are those of `xsl:result-document`, with `href` as written.
//! Results are serialized as UTF-8, whatever encoding the stylesheet
//! asks for, since the editor writes text as UTF-8.

use std::collections::{BTreeSet, HashMap};
use std::sync::{Arc, Mutex, PoisonError};

use serde_json::{Value, json};
use urdr_xdm::{Item, NodeHandle, Sequence};
use urdr_xml_parse::ParseOptions;
use urdr_xml_serialize::{Method, Params};
use urdr_xq_exec::{AvailableDocuments, DynamicError, Span};
use urdr_xslt::{
    CompileOptions, Entry, Messages, Note, SpaceRules, StylesheetCache, TransformOptions, XsltError,
};

use crate::{Answer, Problem};

/// A transformation to run: see the module documentation for its JSON.
#[derive(Debug, Clone, Default)]
pub struct TransformRequest {
    /// The stylesheet's absolute URI.
    pub stylesheet: String,
    /// The stylesheet's text.
    pub stylesheet_text: String,
    /// The source document's URI, if there is one.
    pub source: Option<String>,
    /// The source document's text; `None` runs without a source, which
    /// needs an initial template.
    pub source_text: Option<String>,
    /// Related files' texts by absolute URI.
    pub files: HashMap<String, String>,
    /// Stylesheet parameters: `local` or `Q{uri}local`, and the value.
    pub parameters: Vec<(String, String)>,
    /// The named template to call, as `local` or `Q{uri}local`.
    pub initial_template: Option<String>,
    /// The mode to apply templates in, as `local` or `Q{uri}local`.
    pub initial_mode: Option<String>,
    /// Where the principal result goes, which `xsl:result-document`
    /// resolves its `href` against.
    pub output: Option<String>,
    /// Milliseconds since 1970, for `fn:current-dateTime`.
    pub now: Option<i64>,
    /// The offset from UTC in minutes.
    pub timezone: i16,
}

/// One serialized result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Output {
    /// The `href` of its `xsl:result-document`; empty for the principal
    /// result.
    pub href: String,
    /// The serialized result.
    pub text: String,
    /// The output method: `xml`, `html`, `xhtml`, `text`, `json` or
    /// `adaptive`.
    pub method: &'static str,
    /// The media type, from `media-type` or the method's usual one.
    pub media_type: String,
}

/// What a transformation gave.
#[derive(Debug, Clone, Default)]
pub struct TransformAnswer {
    /// The principal result first, then the secondary ones; empty when
    /// it failed.
    pub results: Vec<Output>,
    /// The texts of `xsl:message`, and warnings, in order.
    pub messages: Vec<String>,
    /// The error that stopped it, and the files still needed.
    pub answer: Answer,
}

impl TransformAnswer {
    /// The answer as JSON.
    #[must_use]
    pub fn to_json(&self) -> String {
        json!({
            "results": self.results.iter().map(|r| json!({
                "href": r.href,
                "text": r.text,
                "method": r.method,
                "mediaType": r.media_type,
            })).collect::<Vec<_>>(),
            "messages": self.messages,
            "problems": self.answer.problems.iter().map(Problem::to_json).collect::<Vec<_>>(),
            "needed": self.answer.needed,
        })
        .to_string()
    }
}

/// Reads a [`TransformRequest`] from JSON.
///
/// # Errors
/// Why the JSON is not a request.
pub fn request_from_json(text: &str) -> Result<TransformRequest, String> {
    let v: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    let string = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_owned);
    let map = |k: &str| -> Vec<(String, String)> {
        v.get(k)
            .and_then(Value::as_object)
            .map(|m| {
                m.iter()
                    .filter_map(|(k, v)| v.as_str().map(|t| (k.clone(), t.to_owned())))
                    .collect()
            })
            .unwrap_or_default()
    };
    Ok(TransformRequest {
        stylesheet: string("stylesheet").ok_or("no stylesheet URI")?,
        stylesheet_text: string("stylesheetText").ok_or("no stylesheet text")?,
        source: string("source"),
        source_text: string("sourceText"),
        files: map("files").into_iter().collect(),
        parameters: map("parameters"),
        initial_template: string("initialTemplate"),
        initial_mode: string("initialMode"),
        output: string("output"),
        now: v.get("now").and_then(Value::as_i64),
        timezone: v
            .get("timezone")
            .and_then(Value::as_i64)
            .and_then(|t| i16::try_from(t).ok())
            .unwrap_or(0),
    })
}

thread_local! {
    /// Compiled stylesheets, so the preview does not compile again while
    /// only the source changes.
    static COMPILED: StylesheetCache = StylesheetCache::new(4);
}

/// Stylesheet modules from the files the caller passed.
#[derive(Debug)]
struct Modules<'a> {
    files: &'a HashMap<String, String>,
    needed: &'a Mutex<BTreeSet<String>>,
}

impl urdr_xslt::ModuleLoader for Modules<'_> {
    fn load(&self, uri: &str) -> Result<Vec<u8>, String> {
        match self.files.get(uri) {
            Some(t) => Ok(t.clone().into_bytes()),
            None => {
                need(self.needed, uri);
                Err(format!("{uri} has not been read yet"))
            }
        }
    }
}

fn need(needed: &Mutex<BTreeSet<String>>, uri: &str) {
    needed
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(uri.to_owned());
}

/// The documents `fn:doc` and `fn:unparsed-text` read, from the files the
/// caller passed. One not given yet is written down as needed.
#[derive(Debug)]
struct Documents {
    files: HashMap<String, String>,
    space: SpaceRules,
    parsed: Mutex<HashMap<String, NodeHandle>>,
    needed: Arc<Mutex<BTreeSet<String>>>,
}

impl Documents {
    fn missing(&self, uri: &str, code: &'static str) -> DynamicError {
        need(&self.needed, uri);
        DynamicError::w3c(
            code,
            format!("{uri} has not been read yet, or cannot be read"),
            Span::default(),
        )
    }
}

impl AvailableDocuments for Documents {
    fn doc(&self, uri: &str) -> Result<NodeHandle, DynamicError> {
        let mut parsed = self.parsed.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(n) = parsed.get(uri) {
            return Ok(n.clone());
        }
        let text = self
            .files
            .get(uri)
            .ok_or_else(|| self.missing(uri, "FODC0002"))?;
        let tree = urdr_xslt::parse_source(
            text.as_bytes(),
            ParseOptions {
                base_uri: Some(uri),
                ..ParseOptions::default()
            },
            &self.space,
        )
        .map_err(|e| {
            DynamicError::w3c(
                "FODC0002",
                format!("{uri} is not well-formed: {}", e.message()),
                Span::default(),
            )
        })?;
        let node = tree.root_handle();
        parsed.insert(uri.to_owned(), node.clone());
        Ok(node)
    }

    fn collection(&self, uri: Option<&str>) -> Result<Vec<NodeHandle>, DynamicError> {
        Err(DynamicError::w3c(
            "FODC0002",
            format!(
                "collections are not available in the editor ({})",
                uri.unwrap_or("the default collection")
            ),
            Span::default(),
        ))
    }

    fn uri_collection(&self, uri: Option<&str>) -> Result<Vec<String>, DynamicError> {
        self.collection(uri).map(|_| Vec::new())
    }

    fn unparsed_text(&self, uri: &str, _encoding: Option<&str>) -> Result<String, DynamicError> {
        self.files
            .get(uri)
            .cloned()
            .ok_or_else(|| self.missing(uri, "FOUT1170"))
    }
}

/// `local` or `Q{uri}local` as an expanded name.
fn eqname(name: &str) -> (String, String) {
    match name
        .strip_prefix("Q{")
        .and_then(|rest| rest.split_once('}'))
    {
        Some((uri, local)) => (uri.to_owned(), local.to_owned()),
        None => (String::new(), name.to_owned()),
    }
}

fn problem(e: &XsltError, stylesheet: &str) -> Problem {
    let (line, column, uri) = match e.location() {
        Some(l) => (
            l.line,
            l.column,
            (l.uri != stylesheet).then(|| l.uri.clone()),
        ),
        None => (0, 0, None),
    };
    Problem {
        code: e.code().to_owned(),
        message: e.message().to_owned(),
        span: None,
        line,
        column,
        uri,
    }
}

fn plain_problem(code: &str, message: String) -> Problem {
    Problem {
        code: code.to_owned(),
        message,
        span: None,
        line: 0,
        column: 0,
        uri: None,
    }
}

/// The text of an `xsl:message`.
fn message_text(message: &Sequence) -> String {
    let xml = Params {
        omit_xml_declaration: true,
        ..Params::default()
    };
    let adaptive = Params {
        method: Method::Adaptive,
        ..xml.clone()
    };
    urdr_xml_serialize::serialize_to_bytes(message, &xml)
        .or_else(|_| urdr_xml_serialize::serialize_to_bytes(message, &adaptive))
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        .unwrap_or_default()
}

fn serialize(href: String, value: &Sequence, params: Params) -> Result<Output, Problem> {
    let (method, usual) = match params.method {
        Method::Xml => ("xml", "application/xml"),
        Method::Html => ("html", "text/html"),
        Method::Xhtml => ("xhtml", "application/xhtml+xml"),
        Method::Text => ("text", "text/plain"),
        Method::Json => ("json", "application/json"),
        Method::Adaptive => ("adaptive", "text/plain"),
    };
    let params = Params {
        encoding: "UTF-8".to_owned(),
        ..params
    };
    let bytes = urdr_xml_serialize::serialize_to_bytes(value, &params)
        .map_err(|e| plain_problem(e.code(), e.message().to_owned()))?;
    Ok(Output {
        href,
        text: String::from_utf8_lossy(&bytes).into_owned(),
        method,
        media_type: params.media_type.unwrap_or_else(|| usual.to_owned()),
    })
}

/// Runs a transformation: see the module documentation.
#[must_use]
pub fn transform(request: &TransformRequest) -> TransformAnswer {
    let needed = Arc::new(Mutex::new(BTreeSet::new()));
    let mut answer = TransformAnswer::default();
    let result = run(request, &needed, &mut answer.messages);
    answer.answer.needed = needed
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .iter()
        .cloned()
        .collect();
    match result {
        Ok(results) => answer.results = results,
        // A file not given yet is reported as needed, not as an error:
        // the caller reads it and runs again.
        Err(_) if !answer.answer.needed.is_empty() => {}
        Err(p) => answer.answer.problems.push(p),
    }
    answer
}

fn run(
    request: &TransformRequest,
    needed: &Arc<Mutex<BTreeSet<String>>>,
    messages: &mut Vec<String>,
) -> Result<Vec<Output>, Problem> {
    let modules = Modules {
        files: &request.files,
        needed,
    };
    let options = CompileOptions {
        loader: Some(&modules),
        ..CompileOptions::default()
    };
    let compiled = COMPILED
        .with(|c| {
            c.compile(
                request.stylesheet_text.as_bytes(),
                &request.stylesheet,
                &options,
            )
        })
        .map_err(|e| problem(&e, &request.stylesheet))?;
    let stylesheet = &*compiled.stylesheet;
    let entry = match (&request.initial_template, &request.initial_mode) {
        (Some(t), _) => Some(Entry::Template(eqname(t))),
        (None, Some(m)) => Some(Entry::Mode(Some(eqname(m)))),
        (None, None) => None,
    };
    let prepared = compiled
        .prepare(entry.as_ref())
        .map_err(|e| problem(&e, &request.stylesheet))?;
    let space = SpaceRules::of(stylesheet);
    let context_item = match &request.source_text {
        Some(text) => {
            let tree = urdr_xslt::parse_source(
                text.as_bytes(),
                ParseOptions {
                    base_uri: request.source.as_deref(),
                    ..ParseOptions::default()
                },
                &space,
            )
            .map_err(|e| {
                plain_problem(
                    "FODC0002",
                    format!("the source document is not well-formed: {}", e.message()),
                )
            })?;
            Some(Item::Node(tree.root_handle()))
        }
        None => None,
    };
    let current_datetime = match request.now {
        Some(ms) => Some(
            urdr_xq_functions::builtins::datetime_from_unix_nanos(
                i128::from(ms) * 1_000_000,
                request.timezone,
            )
            .map_err(|e| plain_problem(e.code(), e.message().to_owned()))?,
        ),
        None => None,
    };
    let documents = Documents {
        files: request.files.clone(),
        space,
        parsed: Mutex::default(),
        needed: Arc::clone(needed),
    };
    let sink = Arc::new(Messages::default());
    let result = urdr_xslt::run(
        stylesheet,
        &prepared,
        TransformOptions {
            context_item,
            params: request
                .parameters
                .iter()
                .map(|(name, value)| {
                    let item = Item::Atomic(urdr_xdm::AtomicValue::untyped(value.as_str()));
                    (eqname(name), Sequence::from(vec![item]))
                })
                .collect(),
            documents: Some(Arc::new(documents) as Arc<dyn AvailableDocuments>),
            messages: Some(Arc::clone(&sink)),
            current_datetime,
            base_output_uri: request.output.clone(),
            ..TransformOptions::default()
        },
    );
    for note in sink.take_all() {
        messages.push(match note {
            Note::Message(m) => message_text(&m),
            Note::Warning(w) => format!("warning: {w}"),
        });
    }
    let result = result.map_err(|e| problem(&e, &request.stylesheet))?;
    let params = result
        .output
        .map_err(|e| problem(&e, &request.stylesheet))?;
    let mut out = vec![serialize(String::new(), &result.principal, params)?];
    for d in result.result_documents {
        let params = d.output.map_err(|e| problem(&e, &request.stylesheet))?;
        out.push(serialize(d.href, &d.value, params)?);
    }
    Ok(out)
}

/// Runs the transformation `request` describes, as JSON in and out.
#[must_use]
pub fn transform_json(request: &str) -> String {
    match request_from_json(request) {
        Ok(r) => transform(&r).to_json(),
        Err(message) => TransformAnswer {
            answer: Answer {
                problems: vec![plain_problem(
                    "REQUEST",
                    format!("the request is not usable: {message}"),
                )],
                needed: Vec::new(),
            },
            ..TransformAnswer::default()
        }
        .to_json(),
    }
}
