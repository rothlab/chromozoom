<?php

header("Content-type: application/json");
require_once("../lib/spyc.php");

$db = urlencode(isset($_GET['db']) ? preg_replace('/[^a-z0-9]/i', '', $_GET['db']) : 'hg18');
$pos = urlencode($_GET['position']);

if (!file_exists("../$db.yaml")) {
  exit('{"error":"specified genome does not exist"}');
}
$genome_config = Spyc::YAMLLoad("../$db.yaml");
$ucsc_config = Spyc::YAMLLoad("../ucsc.yaml");
$serve_tracks = array();
foreach($genome_config['serve_tracks'] as $trk) {
  $serve_tracks[$trk['n']] = true;
}

$url = "{$ucsc_config['browser_hosts']['local']}{$ucsc_config['browser_urls']['tracks']}?db=$db&position=$pos";
if (function_exists('curl_init')) {
  $ch = curl_init($url);
  
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_HEADER, 0);
  
  $html = curl_exec($ch);
  curl_close($ch);
} else {
  $html = file_get_contents($url);
}

$doc = new DOMDocument();
@$doc->loadHTML($html);  // suppress warning messages, UCSC has rickety HTML

$suggest = $items = $doc->getElementById('suggest');
$result = array();

if ($suggest !== NULL) {
  while ($suggest->nodeType != XML_ELEMENT_NODE 
    || ($suggest->getAttribute('name') != 'position' && $suggest->previousSibling)) {
    $suggest = $suggest->previousSibling;
  }
  $result['goto'] = $suggest->getAttribute('value');
} else {
  $items = $doc->getElementsByTagName('a');
  $result['categories'] = array();
  for ($i = 0; $i < min($items->length, 50); $i++) {
    $a = $items->item($i);
    $h2 = $a->parentNode->previousSibling;
    $category = $h2->textContent;
    $choice = array();
    $href = $a->getAttribute('href');
    $href_params = array();
    parse_str(parse_url($href, PHP_URL_QUERY), $href_params);
    $track = array_search("pack", $href_params);
    if (!isset($serve_tracks[$track])) { continue; }
    
    $text = $a->textContent;
    $desc = $a->nextSibling->textContent;
    $choice['pos'] = $href_params['position'];
    $choice['name'] = trim(preg_replace('/\\s+(\\([^\\)]+\\)\\s+)?at\\s+chr[0-9a-zA-Z:-]*$/', '', $text));
    $choice['desc'] = trim(preg_replace('/^\\s*-\\s*/', '', $desc));
    if (!isset($result['categories'][$category])) { $result['categories'][$category] = array("choices"=>array()); }
    $result['categories'][$category]['track'] = $track;
    $result['categories'][$category]['choices'][] = $choice;
  }
}

echo json_encode($result);