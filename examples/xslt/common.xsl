<?xml version="1.0" encoding="UTF-8"?>
<!-- Included by letters-to-html.xsl. -->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0"
                xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xsl:template name="nice-date">
    <xsl:param name="d" as="xs:date"/>
    <xsl:value-of select="format-date($d, '[D] [MNn] [Y]')"/>
  </xsl:template>
</xsl:stylesheet>
