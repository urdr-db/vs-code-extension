(: Imports names.xqm from the same folder. No problems. :)
import module namespace n = "https://example.org/names" at "names.xqm";

let $letters := doc("../schemas/letters-valid.xml")
for $person in n:people($letters)
order by $person
return <person>{ $person }</person>
