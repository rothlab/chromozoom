<?php
/**
 * This page retrieves DNA sequences for a specified area of the genome
 **/

header("Content-type: application/json");
header("Cache-control: max-age=172800, public, must-revalidate");
header('Expires: '.gmdate('D, d M Y H:i:s \G\M\T', time() + 172800));

require_once("../lib/setup.php");

$REQ = $_SERVER['REQUEST_METHOD'] == 'POST' ? $_POST : $_GET;

$ucsc_config = ucsc_config();
$genome_config = array();
$TWOBIT_BIN = escapeshellarg(dirname(dirname(__FILE__)) . '/bin/twoBitToFa');  

function is_seq_line($line) { return !preg_match('/^(<\\/?PRE>|>.*|)$/', $line); }

function seq_from_fasta($fasta) { 
  $seq_lines = array_filter(explode("\n", $fasta), 'is_seq_line'); 
  return implode('', $seq_lines); 
}

function load_genome_layout_from_request() {
  global $genome_config, $REQ;
  $genome_config['chr_order'] = json_decode($REQ['chr_order'], TRUE);
  $genome_config['chr_lengths'] = json_decode($REQ['chr_lengths'], TRUE);
}

$db = isset($REQ['db']) ? $REQ['db'] : NULL;
if ($db === NULL) { forbidden('db parameter not specified'); }
if (preg_match('/^ucsc:/', $db)) {
  $db = explode(':', $db);
  $db = preg_replace('/[^a-z0-9]/i', '', $db[1]);
  load_genome_layout_from_request();
  
  $dna_url = $ucsc_config['browser_hosts']['authoritative'] . $ucsc_config['browser_urls']['dna'];
  $twobit_url = sprintf($ucsc_config['data_urls']['twobit'], $db, $db); // Prefer loading from 2bit, if available
} elseif (preg_match('/^igb:\d+:/', $db)) {
  $db = array_pop(explode(':', $db, 3));
  $db_folder = array_pop(explode('/', preg_replace('#/+$#', '', $db)));
  $twobit_url = "$db/$db_folder.2bit";
  load_genome_layout_from_request();
} else {
  // local, tile-scraped genome
  $db = preg_replace('/[^a-z0-9]/i', '', $db);
  if (!file_exists("../$db.yaml")) { forbidden('genome does not exist'); }
  $genome_config = Spyc::YAMLLoad("../$db.yaml");
  if (!$genome_config['bppp_limits']['nts_below']) { forbidden('no nt segments available for this genome'); }
  
  $dna_url = $ucsc_config['browser_hosts']['local'] . $ucsc_config['browser_urls']['dna'];
}

// This UCSC CGI expects 0-based coordinates
$left = max(intval($REQ['left']) - 1, 0);
$right = max(intval($REQ['right']) - 1, 0);

$max_length = isset($genome_config['max_nt_request']) ? $genome_config['max_nt_request'] : 50000;
if ($right - $left <= 0 || $right - $left > $max_length) { forbidden('invalid segment length'); }

$chr_order = $genome_config['chr_order'];
$chr_lengths = $genome_config['chr_lengths'];

if (!$chr_order) { forbidden('chr_order is not set and could not be loaded'); }

$pos = 0;
$queries = array();
foreach ($chr_order as $chr) {
  $len = $chr_lengths[$chr];
  $next_pos = $pos + $len;
  if ($left < $next_pos && $right > $pos) {
    array_push($queries, array($db, $chr, max($left - $pos, 0), min($right - $pos, $len)));
  }
  $pos = $next_pos;
}
$pad_end = max($right - $pos, 0); // if we requested past the end of the genome

$ret['seq'] = '';
foreach($queries as $query) {
  if (isset($twobit_url)) {
    $opts = vsprintf("-seq=%s -start=%s -end=%s", array_map('escapeshellarg', array_slice($query, 1)));
    $fasta = shell_exec("$TWOBIT_BIN $opts " . escapeshellarg($twobit_url) . " /dev/stdout");
    $ret['cmd'] = "$TWOBIT_BIN $opts " . escapeshellarg($twobit_url) . " /dev/stdout";
  }
  if ((!isset($twobit_url) || $fasta === NULL) && isset($dna_url)) {
    $fasta = file_get_contents(vsprintf($dna_url, array_map('urlencode', $query)));
    $fasta = preg_replace('/.*<PRE>|<\\/PRE>.*/s', '', $fasta);
    $ret['url'] = vsprintf($dna_url, array_map('urlencode', $query));
  }
  $ret['seq'] .= seq_from_fasta($fasta);
}
$ret['seq'] .= str_repeat('-', $pad_end);

echo json_encode($ret);