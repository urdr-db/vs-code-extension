# Changelog

## Unreleased

- Releases no longer include `urdr-xml-examples.zip`.

## 0.5.1

- Typing "urdr" in the Command Palette finds the Urðr-XML commands.
- Surround with Tags lists first the elements that may also hold the
  selection, then the others allowed there.

## 0.5.0

- Element actions as in Oxygen XML Editor, with its keys: Surround with
  Tags (`Ctrl+E`, with the schema's choices), Surround with the Last Tag
  (`Ctrl+/`), Delete Element Tags, Split Element, Join Elements, and
  Rename Element (`F2`), which renames the end tag too. The setting
  `urdr.oxygenShortcuts` turns the keys off.
- Faster XSLT, from the latest Urðr engine: the example ODD compiles in
  about 10 seconds instead of 23, and transformations run faster too.

## 0.4.0

- Runs in VS Code for the Web (vscode.dev, github.dev): checks,
  suggestions, transformations, the preview and ODD files all work in
  the browser.

## 0.3.1

First release on the Visual Studio Marketplace.

- Syntax colours for XQuery, with `(: :)` comments and bracket settings.
- Releases on GitHub: each version tag, and a **dev** build of `main`.

## 0.3.0

- TEI ODD files as schemas: a document whose `<?xml-model?>` names an
  `.odd` is checked against the RELAX NG and Schematron it compiles to,
  with suggestions from it. **Compile ODD to RELAX NG** saves the schema.
- **Transform with XSLT…**, with transforms saved in the workspace
  settings, and a live **XSLT Preview** beside the document.
- Suggestions from the schema while typing (elements, attributes,
  values, closing tags), and hovers with the schema's documentation.
- Validation against RELAX NG, XSD 1.1, Schematron and DTD, and checks
  for XSLT 3.0, XQuery 3.1 and XPath, all with Urðr's own engine.
