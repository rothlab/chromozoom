<?php

header("Content-type: application/json");
require_once("../lib/spyc.php");

/* Allow calling from the command line, when filling the search cache */
$php_cli = isset($_SERVER['argv']) && $_SERVER['argc'] >= 3;
$db_input = $php_cli ? $_SERVER['argv'][1] : (isset($_GET['db']) ? $_GET['db'] : 'hg18');
$pos_input = $php_cli ? $_SERVER['argv'][2] : $_GET['position'];
$db = urlencode(preg_replace('/[^a-z0-9]/i', '', $db_input));
$pos = urlencode(strtoupper($pos_input));

if (!file_exists("../$db.yaml")) {
  exit('{"error":"specified genome does not exist"}');
}
$genome_config = Spyc::YAMLLoad("../$db.yaml");
$ucsc_config = Spyc::YAMLLoad("../ucsc.yaml");
$serve_tracks = array();
foreach($genome_config['serve_tracks'] as $trk) {
  $serve_tracks[$trk['n']] = true;
}
$query = "db=$db&position=$pos";

$tt = NULL;
if (isset($genome_config['search_tch'])) {
  include('../lib/Tyrant.php');
  try {
    if (is_array($genome_config['search_tch'])) {
      $tt = @Tyrant::connect($genome_config['search_tch'][0], $genome_config['search_tch'][1]);
    } else {
      $sock = preg_replace('/[^a-z0-9.]|\\.tch$/i', '', $genome_config['search_tch']);
      $tt = @Tyrant::connect("/tmp/$sock.sock", 0);
    }
    $value = $tt[$query];
    if ($value !== NULL) { echo gzinflate($value); exit; }
  } catch (Exception $e) { $tt = NULL; }
}

$url = "{$ucsc_config['browser_hosts']['local']}{$ucsc_config['browser_urls']['tracks']}?$query";
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

$out = json_encode($result);
echo $out;
if ($tt !== NULL && strlen($pos) < 7) { $tt[$query] = gzdeflate($out); }