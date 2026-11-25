<?xml version="1.0" encoding="UTF-8"?>
<!-- Turns ../tei/letter.xml into an HTML page. That letter names this
     stylesheet in <?xml-stylesheet?>, so "Open XSLT Preview to the Side"
     uses it without asking. -->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0"
                xmlns:tei="http://www.tei-c.org/ns/1.0"
                exclude-result-prefixes="tei" expand-text="yes">
  <xsl:output method="html" html-version="5"/>

  <xsl:template match="/">
    <html>
      <head>
        <title>{//tei:titleStmt/tei:title}</title>
        <style>
          body {{ font-family: Georgia, serif; max-width: 38em; margin: 2em auto; }}
          .place {{ color: #2a6f4e; }}
          .person {{ color: #7a3e9d; }}
        </style>
      </head>
      <body>
        <h1>{//tei:titleStmt/tei:title}</h1>
        <xsl:apply-templates select="//tei:body"/>
      </body>
    </html>
  </xsl:template>

  <xsl:template match="tei:salute"><p><em><xsl:apply-templates/></em></p></xsl:template>
  <xsl:template match="tei:p"><p><xsl:apply-templates/></p></xsl:template>
  <xsl:template match="tei:name[@type = 'place']"><span class="place"><xsl:apply-templates/></span></xsl:template>
  <xsl:template match="tei:name | tei:persName"><span class="person"><xsl:apply-templates/></span></xsl:template>
  <xsl:template match="tei:closer | tei:signed"><p><xsl:apply-templates/></p></xsl:template>
</xsl:stylesheet>
