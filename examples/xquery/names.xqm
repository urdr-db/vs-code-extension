(: A library module, imported by main.xq. :)
module namespace n = "https://example.org/names";

declare function n:people($doc as document-node()) as xs:string* {
  distinct-values($doc//name)
};
