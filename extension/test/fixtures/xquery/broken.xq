(: Problems to find, one at a time:
   1. n:persons is not declared in names.xqm (it is n:people);
   2. after fixing that, $count is never bound. :)
import module namespace n = "https://example.org/names" at "names.xqm";

for $person in n:persons(doc("../schemas/letters-valid.xml"))
return $count
