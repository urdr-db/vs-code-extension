<?xml version="1.0" encoding="UTF-8"?>
<!-- Turns ../schemas/letters-valid.xml into an HTML page. No problems. -->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0"
                expand-text="yes">
  <xsl:include href="common.xsl"/>
  <xsl:output method="html" html-version="5"/>

  <xsl:template match="/letters">
    <html>
      <head><title>Letters</title></head>
      <body>
        <xsl:apply-templates select="letter"/>
      </body>
    </html>
  </xsl:template>

  <xsl:template match="letter">
    <section>
      <h2>{from} to {to}, <xsl:call-template name="nice-date"><xsl:with-param name="d" select="xs:date(@date)" xmlns:xs="http://www.w3.org/2001/XMLSchema"/></xsl:call-template></h2>
      <xsl:apply-templates select="p"/>
    </section>
  </xsl:template>

  <xsl:template match="p"><p><xsl:apply-templates/></p></xsl:template>
  <xsl:template match="name"><a href="{@ref}">{.}</a></xsl:template>
</xsl:stylesheet>
