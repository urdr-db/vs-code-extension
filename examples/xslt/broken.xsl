<?xml version="1.0" encoding="UTF-8"?>
<!-- Problems to find, one at a time (fix one to see the next):
     1. xsl:for-each needs a select attribute;
     2. the XPath in xsl:value-of is cut short. -->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">
  <xsl:template match="/">
    <ul>
      <xsl:for-each>
        <li><xsl:value-of select="from ||"/></li>
      </xsl:for-each>
    </ul>
  </xsl:template>
</xsl:stylesheet>
