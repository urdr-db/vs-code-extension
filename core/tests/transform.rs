//! XSLT transformations, on the stylesheets in `examples/xslt`.
#![allow(clippy::unwrap_used)] // Tests may unwrap.

use std::collections::HashMap;

use urdr_vscode_core::transform::{TransformRequest, transform, transform_json};

const BASE: &str = "file:///e/";

fn example(path: &str) -> String {
    std::fs::read_to_string(format!("{}/../examples/{path}", env!("CARGO_MANIFEST_DIR"))).unwrap()
}

fn uri(path: &str) -> String {
    format!("{BASE}{path}")
}

/// Runs `f` with room for the deep calls of an unoptimized build. The
/// WebAssembly build has a 16 MiB stack (see `.cargo/config.toml`).
fn deep<T: Send>(f: impl FnOnce() -> T + Send) -> T {
    std::thread::scope(|s| {
        std::thread::Builder::new()
            .stack_size(64 << 20)
            .spawn_scoped(s, f)
            .unwrap()
            .join()
            .unwrap()
    })
}

/// Runs `request` as the extension does: reads what the answer says it
/// needed from `examples/`, and runs it again.
fn converse(mut request: TransformRequest) -> urdr_vscode_core::transform::TransformAnswer {
    for _ in 0..10 {
        let answer = deep(|| transform(&request));
        if answer.answer.needed.is_empty() {
            return answer;
        }
        for n in answer.answer.needed {
            let path = n.strip_prefix(BASE).unwrap();
            request.files.insert(n.clone(), example(path));
        }
    }
    panic!("the conversation did not end");
}

#[test]
fn transforms_with_an_included_module() {
    let request = TransformRequest {
        stylesheet: uri("xslt/letters-to-html.xsl"),
        stylesheet_text: example("xslt/letters-to-html.xsl"),
        source: Some(uri("schemas/letters-valid.xml")),
        source_text: Some(example("schemas/letters-valid.xml")),
        ..TransformRequest::default()
    };
    let first = deep(|| transform(&request));
    assert_eq!(first.answer.needed, [uri("xslt/common.xsl")]);
    assert!(first.answer.problems.is_empty());
    let answer = converse(request);
    assert!(
        answer.answer.problems.is_empty(),
        "{:?}",
        answer.answer.problems
    );
    let page = &answer.results[0];
    assert_eq!(
        (page.method, page.media_type.as_str()),
        ("html", "text/html")
    );
    assert!(
        page.text
            .contains("<h2>Dorothy to Mary, 14 March 1802</h2>"),
        "{}",
        page.text
    );
    assert!(
        page.text
            .contains(r#"<a href="https://example.org/coleridge">Coleridge</a>"#)
    );
}

#[test]
fn reads_documents_writes_secondary_results_and_keeps_messages() {
    let answer = converse(TransformRequest {
        stylesheet: uri("xslt/letter-pages.xsl"),
        stylesheet_text: example("xslt/letter-pages.xsl"),
        initial_template: Some("main".to_owned()),
        parameters: vec![("title".to_owned(), "Dorothy's letters".to_owned())],
        output: Some(uri("out/index.html")),
        ..TransformRequest::default()
    });
    assert!(
        answer.answer.problems.is_empty(),
        "{:?}",
        answer.answer.problems
    );
    assert_eq!(answer.messages, ["1 letter(s) found"]);
    let hrefs: Vec<_> = answer.results.iter().map(|r| r.href.as_str()).collect();
    assert_eq!(hrefs, ["", "letter-1.html"]);
    assert!(
        answer.results[0]
            .text
            .contains("<title>Dorothy's letters</title>")
    );
    assert!(answer.results[1].text.contains("William sends his love"));
}

#[test]
fn tei_letter_to_html() {
    let answer = converse(TransformRequest {
        stylesheet: uri("xslt/tei-to-html.xsl"),
        stylesheet_text: example("xslt/tei-to-html.xsl"),
        source: Some(uri("tei/letter.xml")),
        source_text: Some(example("tei/letter.xml")),
        ..TransformRequest::default()
    });
    assert!(
        answer.answer.problems.is_empty(),
        "{:?}",
        answer.answer.problems
    );
    let html = &answer.results[0].text;
    assert!(
        html.contains(r#"<span class="place">Keswick</span>"#),
        "{html}"
    );
    assert!(!html.contains("xmlns:tei"));
}

#[test]
fn dynamic_errors_are_problems_and_the_clock_comes_from_the_caller() {
    let stylesheet = r#"<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">
      <xsl:output method="text"/>
      <xsl:template name="xsl:initial-template">
        <xsl:value-of select="year-from-dateTime(current-dateTime())"/>
        <xsl:message>before</xsl:message>
        <xsl:value-of select="1 div 0"/>
      </xsl:template>
    </xsl:stylesheet>"#;
    let request = |s: &str| TransformRequest {
        stylesheet: uri("t.xsl"),
        stylesheet_text: s.to_owned(),
        now: Some(1_764_096_000_000),
        timezone: 60,
        ..TransformRequest::default()
    };
    let failed = deep(|| transform(&request(stylesheet)));
    assert!(failed.results.is_empty());
    assert_eq!(failed.answer.problems[0].code, "FOAR0001");
    assert_eq!(failed.messages, ["before"]);
    let fine = deep(|| transform(&request(&stylesheet.replace("1 div 0", "'!'"))));
    assert_eq!(fine.results[0].text, "2025!");
    assert_eq!(fine.results[0].method, "text");
}

#[test]
fn json_in_and_out() {
    let files: HashMap<&str, &str> = HashMap::new();
    let request = serde_json::json!({
        "stylesheet": uri("t.xsl"),
        "stylesheetText": r#"<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0"><xsl:param name="who"/><xsl:template match="/"><hi to="{$who}"><xsl:copy-of select="*"/></hi></xsl:template></xsl:stylesheet>"#,
        "source": uri("d.xml"),
        "sourceText": "<d/>",
        "files": files,
        "parameters": {"who": "you"},
    });
    let answer: serde_json::Value =
        serde_json::from_str(&deep(|| transform_json(&request.to_string()))).unwrap();
    assert_eq!(
        answer["results"][0]["text"],
        r#"<?xml version="1.0" encoding="UTF-8"?><hi to="you"><d/></hi>"#
    );
    assert_eq!(answer["results"][0]["mediaType"], "application/xml");
    let bad: serde_json::Value = serde_json::from_str(&transform_json("{}")).unwrap();
    assert_eq!(bad["problems"][0]["code"], "REQUEST");
}
