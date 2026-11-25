//! Schema outlines for suggestions.
#![allow(clippy::unwrap_used)] // Tests may unwrap.

use std::collections::HashMap;

use urdr_vscode_core::outline::{Language, OutlineRequest, outline};

const RNG: &str = r#"<grammar xmlns="http://relaxng.org/ns/structure/1.0"
  datatypeLibrary="http://www.w3.org/2001/XMLSchema-datatypes">
  <start><element name="letters"><oneOrMore><ref name="letter"/></oneOrMore></element></start>
  <include href="parts.rng"/>
</grammar>"#;

const PARTS: &str = r#"<grammar xmlns="http://relaxng.org/ns/structure/1.0">
  <define name="letter"><element name="letter">
    <attribute name="status"><choice><value>draft</value><value>sent</value></choice></attribute>
    <optional><attribute name="n"/></optional>
    <element name="p"><text/></element>
  </element></define>
</grammar>"#;

fn request(files: &[(&str, &str)]) -> OutlineRequest {
    OutlineRequest {
        schemas: vec![(Language::RelaxNg, "file:///s/letters.rng".to_owned())],
        files: files
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect::<HashMap<_, _>>(),
    }
}

#[test]
fn an_outline_asks_for_included_grammars_then_lists_children_and_values() {
    let a = outline(&request(&[("file:///s/letters.rng", RNG)]));
    assert_eq!(a.needed, vec!["file:///s/parts.rng".to_owned()]);
    let a = outline(&request(&[
        ("file:///s/letters.rng", RNG),
        ("file:///s/parts.rng", PARTS),
    ]));
    let o = a.outline.unwrap();
    let letter = o.elements.iter().find(|e| e.name.1 == "letter").unwrap();
    assert_eq!(letter.children, vec![(String::new(), "p".to_owned())]);
    let status = letter
        .attributes
        .iter()
        .find(|a| a.name.1 == "status")
        .unwrap();
    assert!(status.required);
    assert_eq!(status.values, vec!["draft".to_owned(), "sent".to_owned()]);
    let n = letter.attributes.iter().find(|a| a.name.1 == "n").unwrap();
    assert!(!n.required);
    assert!(
        o.elements
            .iter()
            .find(|e| e.name.1 == "letters")
            .unwrap()
            .top
    );
}

#[test]
fn xsd_outlines_too() {
    let xsd = r#"<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
      <xs:element name="a"><xs:complexType><xs:sequence><xs:element name="b" type="xs:string"/></xs:sequence>
      <xs:attribute name="k" use="required"><xs:simpleType><xs:restriction base="xs:string"><xs:enumeration value="x"/></xs:restriction></xs:simpleType></xs:attribute>
      </xs:complexType></xs:element></xs:schema>"#;
    let a = outline(&OutlineRequest {
        schemas: vec![(Language::Xsd, "file:///s/a.xsd".to_owned())],
        files: HashMap::from([("file:///s/a.xsd".to_owned(), xsd.to_owned())]),
    });
    let o = a.outline.unwrap();
    let el = o.elements.iter().find(|e| e.name.1 == "a").unwrap();
    assert_eq!(el.attributes[0].values, vec!["x".to_owned()]);
}

#[test]
fn no_schema_says_why() {
    let a = outline(&OutlineRequest::default());
    assert!(a.outline.is_none());
    assert!(!a.note.is_empty());
}
