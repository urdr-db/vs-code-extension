# TEI stylesheets for compiling ODD files

The parts of the [TEI Stylesheets](https://github.com/TEIC/Stylesheets)
that compile an ODD file into a RELAX NG schema, with the ODD's
Schematron rules embedded in it, from release 7.61.0, with the TEI P5 source they compile against
(`source/p5subset.xml`, TEI P5 4.12.0). The extension runs them on
Urðr's XSLT engine. They are © the TEI Consortium, under the BSD
2-clause licence or CC BY-SA 3.0 (see `LEGAL/LICENCE`).

| File | Used for |
|---|---|
| `odds/odd2odd.xsl` | merging the ODD with the TEI source |
| `odds/odd2relax.xsl` and what it imports | the RELAX NG schema |

They are unchanged.

## Updating

Copy the same files from a newer release, with its `VERSION` and
`source/p5subset.xml`, and update the version numbers here. Compiled
ODDs are kept by that version, so they compile again.
