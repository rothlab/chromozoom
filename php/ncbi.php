<?php
/**
 * Searchs NCBI Nucleotide and Assembly for sequences/assemblies that can be loaded into chromozoom
 * If the `db` and `uid` parameters are given, streams the data for that particular NCBI nucleotide/assembly entry
 **/

header("Content-type: application/json");
header("Cache-control: max-age=172800, public, must-revalidate");
header('Expires: '.gmdate('D, d M Y H:i:s \G\M\T', time() + 172800)); // 2 days

require_once("../lib/setup.php");

$response = array();
$ucsc_config = ucsc_config();

$eutils_base_url = $ucsc_config['ncbi']['eutils_url'];
$search_query = $ucsc_config['ncbi']['search_query'];
$summary_query = $ucsc_config['ncbi']['summary_query'];
$fetch_query = $ucsc_config['ncbi']['fetch_query'];
$query_suffix = $ucsc_config['ncbi']['query_suffix'] . urlencode($ucsc_config['ncbi']['admin_email']);

function getNcbiUids($db, $search) {
  global $eutils_base_url, $search_query, $query_suffix;
  $dom = new DOMDocument;
  // Suffixing $search with '*' allows prefix-based searching
  $search_url = sprintf("$eutils_base_url$search_query", urlencode($db), urlencode($search . '*')) . $query_suffix;
  @$dom->loadXML(file_get_contents($search_url));
  $xpath = new DOMXPath($dom);
  $node_list = $xpath->query("//IdList/Id");
  $uids = array();
  foreach($node_list as $node) { array_push($uids, $node->textContent); }
  return $uids;
}

function getNcbiSummary($db, $uids, $nodes_query, $mapping) {
  global $eutils_base_url, $summary_query, $query_suffix;
  $dom = new DOMDocument;
  $summary_url = sprintf("$eutils_base_url$summary_query", urlencode($db), urlencode(implode(',', $uids))) . $query_suffix;
  @$dom->loadXML(file_get_contents($summary_url));
  $xpath = new DOMXPath($dom);
  $node_list = $xpath->query($nodes_query);
  $results = array();
  foreach($node_list as $node) {
    $result = array();
    if ($node->attributes !== NULL) { $result['uid'] = $node->attributes->getNamedItem('uid')->nodeValue; }
    foreach ($mapping as $key => $xpath_query) {
      $sub_node = $xpath->query($xpath_query, $node);
      if ($sub_node->length == 1) { $result[$key] = $sub_node->item(0)->textContent; }
    }
    array_push($results, $result);
  }
  return $results;
}

function accessionIsntRefSeq($result) {
  return preg_match('#_#', $result["accession"]) === 0;
}

if (isset($_GET['db']) && isset($_GET['uid'])) {
  if (preg_match('#^\\d+$#', $_GET['uid'])!==1) { forbidden(); }
  
  require_once("../lib/proxy.php");
  if ($_GET['db'] === 'nucleotide') {
    proxy(sprintf("$eutils_base_url$fetch_query", 'nucleotide', $_GET['uid']));
  } elseif ($_GET['db'] === 'assembly') {
    // TODO: For assemblies:
    // ... pull out the <FtpPath_GenBank>, produce the corresponding .gbff.gz URL
  }
} else if (isset($_GET['search'])) {
  $SEARCH = $_GET['search'];
  
  /*****
   *  Search NCBI Nucleotide first
   *****/
  $uids = getNcbiUids('nucleotide', $_GET['search']);
  $response['nucleotide'] = getNcbiSummary('nucleotide', $uids, '//DocSum', array(
    "uid" => "./Id",
    "accession" => "./Item[@Name='AccessionVersion']",
    "title" => "./Item[@Name='Title']",
    "created" => "./Item[@Name='CreateDate']"
  ));
  // Filter out RefSeq hits (with underscores in accessions) since they only link indirectly to GenBank sequence data
  $response['nucleotide'] = array_filter($response['nucleotide'], 'accessionIsntRefSeq');
  
  /*****
   *  Then search NCBI Assembly
   *****/
  $uids = getNcbiUids('assembly', $_GET['search']);
  $response['assembly'] = getNcbiSummary('assembly', $uids, '//DocumentSummary', array(
    "accession" => "./AssemblyAccession",
    "species" => "./SpeciesName",
    "submitter" => "./SubmitterOrganization",
    "created" => "./SubmissionDate"
  ));
  
  echo json_encode($response);
}