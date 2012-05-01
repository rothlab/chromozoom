<?php
/**
 * This page retrieves DNA sequences for a specified area of the genome
 **/

header("Content-type: application/json");
header("Cache-control: max-age=172800, public, must-revalidate");
header('Expires: '.gmdate('D, d M Y H:i:s \G\M\T', time() + 172800));
require_once("../lib/spyc.php");

function forbidden($err) { header('HTTP/1.1 403 Forbidden'); if (strlen($err)) { echo json_encode(array('error'=>$err)); } exit; }

function is_seq_line($line) { return !preg_match('/^(<\\/?PRE>|>.*|)$/', $line); }

function seq_from_fasta($fasta) { 
  $seq_lines = array_filter(explode("\n", $fasta), 'is_seq_line'); 
  return implode('', $seq_lines); 
}

$db = urlencode(isset($_GET['db']) ? preg_replace('/[^a-z0-9]/i', '', $_GET['db']) : 'hg18');
// This UCSC CGI expects 0-based coordinates
$left = max(intval($_GET['left']) - 1, 0);
$right = max(intval($_GET['right']) - 1, 0);

if (!file_exists("../$db.yaml")) { forbidden('genome does not exist'); }
$genome_config = Spyc::YAMLLoad("../$db.yaml");
$ucsc_config = Spyc::YAMLLoad("../ucsc.yaml");
if (!$genome_config['bppp_limits']['nts_below']) { forbidden('no nt segments available for this genome'); }
$max_length = $genome_config['max_nt_request'];
if ($right - $left <= 0 || $right - $left > $max_length) { forbidden('invalid segment length'); }

$chr_order = $genome_config['chr_order'];
$chr_lengths = $genome_config['chr_lengths'];

$dna_url = $ucsc_config['browser_hosts']['local'] . $ucsc_config['browser_urls']['dna'];

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
  $fasta = file_get_contents(vsprintf($dna_url, array_map('urlencode', $query)));
  $ret['seq'] .= seq_from_fasta($fasta);
}
$ret['seq'] .= str_repeat('-', $pad_end);

echo json_encode($ret);