# Changelog

## Unreleased

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
