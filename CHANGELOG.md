# Changelog

## 0.6.1

- The latest Urðr engine (f6e0a47): XSLT runs more than twice as fast.
  TEI Lite's ODD compiles in about 7 seconds instead of 18. It also
  brings XSLT 3.0 fixes: result documents finished inside an `xsl:try`
  are kept, and each package strips whitespace by its own rules.

## 0.6.0

In XML and XSLT files, `Ctrl+Shift+P` (`Cmd+Shift+P`) now runs Format
and Indent, as in Oxygen. `F1` still opens the Command Palette, and
turning off `urdr.oxygenShortcuts` gives the key back.

- XSLT and XQuery: Go to Definition, Find All References and the
  Outline for templates, functions, variables, parameters, modes, keys
  and attribute sets, across included and imported modules.
- Quick fixes for schema problems: add the required attributes a start
  tag lacks, change an element to one the parent allows, remove or
  change an attribute the element doesn't allow, and change a value to
  one the attribute takes.
- **Format and Indent** (`Ctrl+Shift+P`, as in Oxygen) puts each element
  that holds only elements on its own lines, and keeps mixed content,
  such as a TEI `<p>`, as written. Format Document uses it too.
- **Select Element** selects the element around the selection, and then
  the next one out. Expand Selection grows by elements too.
- **Go to Matching Tag** moves between an element's start and end tag.
- **Evaluate XPath…** runs an expression on the open document and lists
  the results; moving through them shows each node.
- TEI ids: go from `#id` to the element with that `xml:id` (also in
  another file), find and rename every pointer to an id, ids suggested
  after `#`, and ids given twice or missing flagged.
- XPath colours in XSLT and Schematron attributes and in XSLT attribute
  value templates.
- The status bar shows the caret's path of elements, and **Copy XPath**
  copies it.
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
