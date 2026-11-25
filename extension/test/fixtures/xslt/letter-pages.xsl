<?xml version="1.0" encoding="UTF-8"?>
<!-- Runs without a source document: start it at the template "main".
     It reads ../schemas/letters-valid.xml with doc(), writes one page per
     letter with xsl:result-document, and says what it did with
     xsl:message. The parameter "title" names the index page. -->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                exclude-result-prefixes="xs" expand-text="yes">
  <xsl:param name="title" select="'Letters'"/>
  <xsl:output method="html" html-version="5"/>

  <xsl:template name="main">
    <xsl:variable name="letters" select="doc('../schemas/letters-valid.xml')//letter"/>
    <xsl:message>{count($letters)} letter(s) found</xsl:message>
    <html>
      <head><title>{$title}</title></head>
      <body>
        <h1>{$title}</h1>
        <ul>
          <xsl:for-each select="$letters">
            <xsl:variable name="page" select="'letter-' || position() || '.html'"/>
            <li><a href="{$page}">{from} to {to}</a></li>
            <xsl:result-document href="{$page}">
              <html><body><h1>{from} to {to}</h1><xsl:copy-of select="p"/></body></html>
            </xsl:result-document>
          </xsl:for-each>
        </ul>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
