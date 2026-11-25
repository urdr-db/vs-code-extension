//! The checks the extension runs, without the WebAssembly glue.
#![allow(clippy::unwrap_used)] // Tests may unwrap.

use std::collections::HashMap;

use urdr_vscode_core::{Request, check_xpath, check_xquery, check_xslt, resolve, validate_json};

fn request(text: &str, uri: &str, files: &[(&str, &str)]) -> Request {
    Request {
        text: text.to_owned(),
        uri: uri.to_owned(),
        files: files
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect::<HashMap<_, _>>(),
    }
}

#[test]
fn uris_resolve_like_rfc_3986() {
    let base = "file:///edition/xslt/main.xsl";
    assert_eq!(
        resolve(base, "common.xsl"),
        "file:///edition/xslt/common.xsl"
    );
    assert_eq!(resolve(base, "../lib/a.xqm"), "file:///edition/lib/a.xqm");
    assert_eq!(resolve(base, "/x.xsl"), "file:///x.xsl");
    assert_eq!(
        resolve(base, "https://tei-c.org/tei_all.rng"),
        "https://tei-c.org/tei_all.rng"
    );
}

#[test]
fn a_query_with_a_syntax_error_says_where() {
    let a = check_xquery(&request("let $x := 1 return $x +", "file:///q.xq", &[]));
    assert_eq!(a.problems.len(), 1);
    assert_eq!(a.problems[0].code, "XPST0003");
    assert!(a.problems[0].span.is_some());
    let fine = check_xquery(&request("let $x := 1 return $x + 1", "file:///q.xq", &[]));
    assert!(fine.problems.is_empty());
}

#[test]
fn a_query_asks_for_the_modules_it_imports() {
    let main = r#"import module namespace m = "urn:m" at "lib/m.xqm"; m:f()"#;
    let a = check_xquery(&request(main, "file:///p/main.xq", &[]));
    assert!(a.problems.is_empty());
    assert_eq!(a.needed, vec!["file:///p/lib/m.xqm".to_owned()]);
    let lib = r#"module namespace m = "urn:m"; declare function m:f() { 1 };"#;
    let a = check_xquery(&request(
        main,
        "file:///p/main.xq",
        &[("file:///p/lib/m.xqm", lib)],
    ));
    assert!(a.problems.is_empty(), "{:?}", a.problems);
    assert!(a.needed.is_empty());
    // An undeclared function is a static error once the module is there.
    let wrong = main.replace("m:f()", "m:g()");
    let a = check_xquery(&request(
        &wrong,
        "file:///p/main.xq",
        &[("file:///p/lib/m.xqm", lib)],
    ));
    assert_eq!(a.problems[0].code, "XPST0017");
}

#[test]
fn xpath_is_checked_as_xpath() {
    // A FLWOR `let` with a `where` is XQuery, not XPath.
    let a = check_xpath(&request("for $x in 1 where $x return $x", "file:///e", &[]));
    assert_eq!(a.problems[0].code, "XPST0003");
    assert!(
        check_xpath(&request("//p[@n = 1]", "file:///e", &[]))
            .problems
            .is_empty()
    );
}

const XSL: &str = r#"xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0""#;

#[test]
fn a_stylesheet_error_has_a_line_and_column() {
    let text = format!("<xsl:stylesheet {XSL}>\n  <xsl:template match=\"p[\"/>\n</xsl:stylesheet>");
    let a = check_xslt(&request(&text, "file:///s/main.xsl", &[]));
    assert_eq!(a.problems.len(), 1, "{:?}", a.problems);
    assert_eq!(a.problems[0].line, 2);
    let text = format!("<xsl:stylesheet {XSL}><xsl:bogus/></xsl:stylesheet>");
    let a = check_xslt(&request(&text, "file:///s/main.xsl", &[]));
    assert_eq!(a.problems[0].code, "XTSE0010");
}

#[test]
fn a_stylesheet_asks_for_the_modules_it_includes() {
    let text = format!(
        r#"<xsl:stylesheet {XSL}><xsl:include href="common.xsl"/><xsl:template match="/"><xsl:call-template name="c"/></xsl:template></xsl:stylesheet>"#
    );
    let a = check_xslt(&request(&text, "file:///s/main.xsl", &[]));
    assert!(a.problems.is_empty(), "{:?}", a.problems);
    assert_eq!(a.needed, vec!["file:///s/common.xsl".to_owned()]);
    let common = format!(r#"<xsl:stylesheet {XSL}><xsl:template name="c"/></xsl:stylesheet>"#);
    let a = check_xslt(&request(
        &text,
        "file:///s/main.xsl",
        &[("file:///s/common.xsl", &common)],
    ));
    assert!(a.problems.is_empty() && a.needed.is_empty(), "{a:?}");
}

#[test]
fn a_document_is_validated_as_urdr_validates_it() {
    let rng = r#"<element name="a" xmlns="http://relaxng.org/ns/structure/1.0"><empty/></element>"#;
    let request = serde_json::json!({
        "document": "<?xml-model href=\"a.rng\"?><a><b/></a>",
        "base": "file:///d/doc.xml",
        "files": { "file:///d/a.rng": rng },
    });
    let answer: serde_json::Value =
        serde_json::from_str(&validate_json(&request.to_string())).unwrap();
    assert_eq!(answer["status"], "invalid", "{answer}");
}
