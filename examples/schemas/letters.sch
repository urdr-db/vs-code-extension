<?xml version="1.0" encoding="UTF-8"?>
<!-- Schematron rules a grammar cannot say: checked as well as letters.rng. -->
<schema xmlns="http://purl.oclc.org/dsdl/schematron" queryBinding="xslt2">
  <pattern>
    <rule context="letter">
      <assert test="from != to" id="not-to-self">A letter is not written to its own sender (<value-of select="from"/>).</assert>
    </rule>
    <rule context="name[@ref]">
      <assert test="starts-with(@ref, 'https://')" id="ref-https">A name's ref should be an https address.</assert>
    </rule>
  </pattern>
</schema>
