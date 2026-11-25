//! A schema's outline for suggestions: which elements may hold which
//! children and attributes, and which values they may take
//! ([`urdr_xml_validate::outline`], the same outline Studio's editor
//! suggests from).
//!
//! The extension finds the schemas a document names itself, from its
//! prolog and root start tag, so suggestions still work while the
//! document is half typed and not well-formed. It passes their absolute
//! URIs here.

use std::cell::RefCell;
use std::collections::hash_map::DefaultHasher;
use std::collections::{BTreeSet, HashMap};
use std::hash::{Hash, Hasher};

use serde_json::{Value, json};
use urdr_xdm::NodeHandle;
use urdr_xml_parse::{ParseOptions, parse_tree};
use urdr_xml_validate::outline::Outline;
use urdr_xml_validate::rng;
use urdr_xml_validate::xsd::{self, SchemaResolver};

/// The schema language of a schema the document names.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Language {
    /// RELAX NG, XML syntax.
    RelaxNg,
    /// RELAX NG, compact syntax.
    Compact,
    /// XSD.
    Xsd,
}

impl Language {
    fn from_name(name: &str) -> Option<Self> {
        match name {
            "rng" => Some(Self::RelaxNg),
            "rnc" => Some(Self::Compact),
            "xsd" => Some(Self::Xsd),
            _ => None,
        }
    }
}

/// What to outline: the schemas, all in one language, and every schema
/// text read so far by absolute URI.
#[derive(Debug, Clone, Default)]
pub struct OutlineRequest {
    /// The language and the absolute URIs of the schemas. XSD may name
    /// several (one per namespace); RELAX NG names one.
    pub schemas: Vec<(Language, String)>,
    /// Schema texts by absolute URI.
    pub files: HashMap<String, String>,
}

/// Reads an [`OutlineRequest`] from JSON:
/// `{"schemas": [{"language": "rng"|"rnc"|"xsd", "uri"}], "files": {uri: text}}`.
///
/// # Errors
/// Why the JSON is not a request.
pub fn request_from_json(text: &str) -> Result<OutlineRequest, String> {
    let v: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    let schemas = v
        .get("schemas")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|s| {
                    let lang = Language::from_name(s.get("language")?.as_str()?)?;
                    Some((lang, s.get("uri")?.as_str()?.to_owned()))
                })
                .collect()
        })
        .unwrap_or_default();
    let files = v
        .get("files")
        .and_then(Value::as_object)
        .map(|m| {
            m.iter()
                .filter_map(|(k, v)| v.as_str().map(|t| (k.clone(), t.to_owned())))
                .collect()
        })
        .unwrap_or_default();
    Ok(OutlineRequest { schemas, files })
}

/// Schema texts from the request, noting the ones not given.
struct Files<'a> {
    texts: &'a HashMap<String, String>,
    needed: RefCell<BTreeSet<String>>,
}

impl Files<'_> {
    fn text(&self, uri: &str) -> Option<&str> {
        let uri = uri.split('#').next().unwrap_or(uri);
        let t = self.texts.get(uri).map(String::as_str);
        if t.is_none() {
            self.needed.borrow_mut().insert(uri.to_owned());
        }
        t
    }

    fn document(&self, uri: &str) -> Result<Option<NodeHandle>, String> {
        let Some(text) = self.text(uri) else {
            return Ok(None);
        };
        let options = ParseOptions {
            base_uri: Some(uri),
            ..ParseOptions::default()
        };
        parse_tree(text.as_bytes(), options)
            .map(|t| Some(t.root_handle()))
            .map_err(|e| format!("{uri} is not well-formed: {}", e.message()))
    }
}

impl rng::Resolver for Files<'_> {
    fn resolve(&self, uri: &str) -> Result<Option<NodeHandle>, String> {
        self.document(uri)
    }

    fn resolve_compact(&self, uri: &str) -> Result<Option<String>, String> {
        Ok(self.text(uri).map(str::to_owned))
    }
}

impl SchemaResolver for Files<'_> {
    fn resolve(
        &self,
        base: Option<&str>,
        location: Option<&str>,
        _namespace: Option<&str>,
    ) -> Result<Option<NodeHandle>, String> {
        let (Some(base), Some(location)) = (base, location) else {
            return Ok(None);
        };
        self.document(&crate::resolve(base, location))
    }
}

/// The answer: the outline, or why there is none, and the files needed.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct OutlineAnswer {
    /// The outline, when the schemas could be read.
    pub outline: Option<Outline>,
    /// Why there is no outline, for people; empty when there is one or
    /// when files are still needed.
    pub note: String,
    /// Absolute URIs needed and not given.
    pub needed: Vec<String>,
}

thread_local! {
    /// The last outline made, by a print of the request: a large grammar
    /// such as `tei_all.rng` is read once while its texts stay the same.
    static KEPT: RefCell<Option<(u64, OutlineAnswer)>> = const { RefCell::new(None) };
}

fn print(request: &OutlineRequest) -> u64 {
    let mut h = DefaultHasher::new();
    request.schemas.hash(&mut h);
    let mut files: Vec<_> = request.files.iter().collect();
    files.sort();
    files.hash(&mut h);
    h.finish()
}

/// The outline of the schemas a request names.
#[must_use]
pub fn outline(request: &OutlineRequest) -> OutlineAnswer {
    let key = print(request);
    if let Some(kept) = KEPT.with(|k| {
        k.borrow()
            .as_ref()
            .filter(|(p, _)| *p == key)
            .map(|(_, a)| a.clone())
    }) {
        return kept;
    }
    let answer = make(request);
    KEPT.with(|k| *k.borrow_mut() = Some((key, answer.clone())));
    answer
}

fn make(request: &OutlineRequest) -> OutlineAnswer {
    let files = Files {
        texts: &request.files,
        needed: RefCell::default(),
    };
    let Some(&(language, ref first)) = request.schemas.first() else {
        return OutlineAnswer {
            note: "the document names no RELAX NG or XSD schema".to_owned(),
            ..OutlineAnswer::default()
        };
    };
    let result: Result<Option<Outline>, String> = match language {
        Language::RelaxNg => match files.document(first) {
            Ok(Some(root)) => rng::load_with(&root, &files)
                .map(|s| Some(s.outline()))
                .map_err(|e| e.to_string()),
            Ok(None) => Ok(None),
            Err(e) => Err(e),
        },
        Language::Compact => match files.text(first) {
            Some(text) => rng::load_compact(text, Some(first), &files)
                .map(|s| Some(s.outline()))
                .map_err(|e| e.to_string()),
            None => Ok(None),
        },
        Language::Xsd => 'xsd: {
            let mut roots = Vec::new();
            let mut missing = false;
            for (_, uri) in request.schemas.iter().filter(|(l, _)| *l == Language::Xsd) {
                match files.document(uri) {
                    Ok(Some(r)) => roots.push(r),
                    Ok(None) => missing = true,
                    Err(e) => break 'xsd Err(e),
                }
            }
            if missing {
                Ok(None)
            } else {
                xsd::load_with(&roots, &files)
                    .map(|s| Some(s.outline()))
                    .map_err(|e| e.to_string())
            }
        }
    };
    let needed: Vec<String> = files.needed.borrow().iter().cloned().collect();
    match result {
        // A schema that includes one not read yet fails to load: ask for
        // it rather than report the failure.
        _ if !needed.is_empty() => OutlineAnswer {
            needed,
            ..OutlineAnswer::default()
        },
        Ok(outline) => OutlineAnswer {
            outline,
            ..OutlineAnswer::default()
        },
        Err(e) => OutlineAnswer {
            note: format!("the schema is not usable: {e}"),
            ..OutlineAnswer::default()
        },
    }
}

/// The answer as JSON: `{"outline": {"elements": [...]} | null, "note", "needed"}`,
/// names as `[namespace, local]`.
#[must_use]
pub fn answer_to_json(answer: &OutlineAnswer) -> String {
    let name = |n: &(String, String)| json!([n.0, n.1]);
    let outline = answer.outline.as_ref().map(|o| {
        json!({
            "elements": o.elements.iter().map(|e| json!({
                "name": name(&e.name),
                "top": e.top,
                "children": e.children.iter().map(name).collect::<Vec<_>>(),
                "anyChildren": e.any_children,
                "text": e.text,
                "textValues": e.text_values,
                "attributes": e.attributes.iter().map(|a| json!({
                    "name": name(&a.name),
                    "required": a.required,
                    "values": a.values,
                })).collect::<Vec<_>>(),
                "anyAttributes": e.any_attributes,
            })).collect::<Vec<_>>(),
        })
    });
    json!({ "outline": outline, "note": answer.note, "needed": answer.needed }).to_string()
}
