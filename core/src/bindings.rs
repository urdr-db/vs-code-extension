//! The functions the extension calls, as `wasm-bindgen` exports them.
//! Each takes and returns JSON, as the crate root describes.
//!
//! The `#[wasm_bindgen]` marker writes glue with `#[unsafe(no_mangle)]`
//! export markers, the only unsafe code in the crate.
#![allow(unsafe_code)]

use wasm_bindgen::prelude::wasm_bindgen;

use crate::{Answer, Problem, request_from_json};

fn answer(request: &str, check: fn(&crate::Request) -> Answer) -> String {
    match request_from_json(request) {
        Ok(r) => check(&r).to_json(),
        Err(message) => Answer {
            problems: vec![Problem {
                code: "REQUEST".to_owned(),
                message: format!("the request is not usable: {message}"),
                span: None,
                line: 0,
                column: 0,
                uri: None,
            }],
            needed: Vec::new(),
        }
        .to_json(),
    }
}

/// Checks an XML document against its schemas.
#[wasm_bindgen(js_name = validateDocument)]
#[must_use]
pub fn validate_document(request: &str) -> String {
    crate::validate_json(request)
}

/// Checks an XQuery module.
#[wasm_bindgen(js_name = checkXquery)]
#[must_use]
pub fn check_xquery(request: &str) -> String {
    answer(request, crate::check_xquery)
}

/// Checks an XPath expression.
#[wasm_bindgen(js_name = checkXpath)]
#[must_use]
pub fn check_xpath(request: &str) -> String {
    answer(request, crate::check_xpath)
}

/// Checks an XSLT stylesheet.
#[wasm_bindgen(js_name = checkXslt)]
#[must_use]
pub fn check_xslt(request: &str) -> String {
    answer(request, crate::check_xslt)
}

/// The outline of the schemas a document names, for suggestions.
#[wasm_bindgen(js_name = schemaOutline)]
#[must_use]
pub fn schema_outline(request: &str) -> String {
    match crate::outline::request_from_json(request) {
        Ok(r) => crate::outline::answer_to_json(&crate::outline::outline(&r)),
        Err(message) => crate::outline::answer_to_json(&crate::outline::OutlineAnswer {
            note: format!("the request is not usable: {message}"),
            ..crate::outline::OutlineAnswer::default()
        }),
    }
}

/// Runs an XSLT transformation.
#[wasm_bindgen(js_name = transformXslt)]
#[must_use]
pub fn transform_xslt(request: &str) -> String {
    crate::transform::transform_json(request)
}
