<?php

header("Content-type: application/json");
header("Cache-control: max-age=172800, public, must-revalidate");
header('Expires: '.gmdate('D, d M Y H:i:s \G\M\T', time() + 172800));
require_once("../lib/spyc.php");

function bad_request() {
  header('HTTP/1.1 403 Forbidden');
  exit;
}

if (!isset($_GET['url']) || !preg_match('#^https?://#', $_GET['url'])) { bad_request(); }
$url = $_GET['url'];
$ucsc_config = Spyc::YAMLLoad("../ucsc.yaml");
if (strpos($url, $ucsc_config['browser_hosts']['authoritative']) !== 0) { bad_request(); }
$url = $ucsc_config['browser_hosts']['local'] . substr($url, strlen($ucsc_config['browser_hosts']['authoritative']));

$html = file_get_contents($url);

$doc = new DOMDocument();
@$doc->loadHTML($html);  // suppress warning messages, UCSC has rickety HTML
$sx_body = simplexml_import_dom($doc->getElementsByTagName('body')->item(0));
$sx_subheadings_tds = $sx_body->xpath('//div[@class="subheadingBar"]/..');

if (!count($sx_subheadings_tds)) { bad_request(); }
$sx_desc_td = $sx_subheadings_tds[0]->table[0]->tr[1]->td[1];
if (!count($sx_desc_td)) { bad_request(); }

$td = dom_import_simplexml($sx_desc_td);
$td_children = $td->childNodes;

$results = array();
$key = '';
$val = '';
$line_broken = false;

function push_val($item=NULL) {
  global $val, $key, $results, $line_broken;
  $val = trim(str_replace("\xc2\xa0", '', $val)); // kill &nbsp; characters as they appear in UTF-8.
  // Some of those Author lines get ridiculously, unhelpfully long.
  if (strtolower($key) == 'author') { $val = preg_replace('/^([^,]+[,\\s][^,]+,).*/', '$1 et al.', $val); }
  if (strlen($val) && strlen($key)) { $results[$key] = $val; }
  $val = '';
  if ($item) { $key = rtrim($item->textContent, ': '); }
  $line_broken = false;
}

// Get everything in the first table-ish structure up to the next <hr> or non-nested <table>
function extract_vals($td_children) {
  global $val, $key, $results, $line_broken;
  for ($i = 0; $i < $td_children->length; $i++) {
    $item = $td_children->item($i);
    switch ($item->nodeType) {
      case XML_TEXT_NODE:
        if (!$line_broken) { $val .= $item->textContent; }
        break;
      case XML_ELEMENT_NODE:
        switch (strtolower($item->tagName)) {
          case 'b':
            push_val($item);
            break;
          case 'a':
            if (!$line_broken) { $val .= $item->textContent; }
            break;
          case 'br':
            $line_broken = true;
            break;
          case 'table':
            if (!count($results)) {
              @extract_vals(dom_import_simplexml(simplexml_import_dom($item)->tr[0]->td[0])->childNodes);
            }
            break 3;
          case 'hr':
            break 3;
        }
    }
  }
}

extract_vals($td_children);
push_val();

echo json_encode($results);