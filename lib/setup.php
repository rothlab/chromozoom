<?php

define("BASEDIR", dirname(dirname(__FILE__)));
date_default_timezone_set('America/New_York');

// Return an HTTP 403 and optionally a JSON string encoding an error. Used to indicate invalid input.
function forbidden($err=NULL) { 
  header('HTTP/1.1 403 Forbidden');
  if ($err && strlen($err)) { echo json_encode(array('error'=>$err)); }
  exit;
}

// Returns either the user's customized ucsc.yaml if it exists or the default distributed one.
function where_is_ucsc_yaml() {
  $ucsc_dist_yaml = BASEDIR . "/ucsc.dist.yaml";
  $ucsc_yaml = BASEDIR . "/ucsc.yaml";
  return file_exists($ucsc_yaml) ? $ucsc_yaml : $ucsc_dist_yaml;
}

// Returns an associative array holding the contents of ucsc[.dist].yaml, cached across calls
function ucsc_config() {
  require_once dirname(__FILE__) . "/spyc.php";
  // Cache the config across function calls so it is only ever parsed once
  static $config = NULL;
  if ($config === NULL) { $config = Spyc::YAMLLoad(where_is_ucsc_yaml()); }
  return $config;
}

// Checks if a given binary $bin is in bin/; if not and it's in PATH, it's symlinked into bin/
function not_symlinked_or_found_on_path($bin) {
  $symlink = BASEDIR . '/bin/' . $bin;
  if (@is_executable($symlink)) { return false; }
  $output = array(); $retval = 0;
  exec("which $bin", $output, $retval);
  if ($retval === 0) {
    if (!is_dir(dirname($symlink))) { mkdir(dirname($symlink)); }
    exec("ln -s " . escapeshellarg($output[0]) . " " . escapeshellarg($symlink));
    return false;
  } else {
    return true;
  }
}

function find_and_link_binaries($bins) {
  return array_filter($bins, 'not_symlinked_or_found_on_path');
}

// Check that that ucsc_config()['tmp_dir'] exists (creates it if not) and is writable.
function ensure_tmp_dir_exists() {
  $ucsc_config = ucsc_config();
  $pwu_data = posix_getpwuid(posix_geteuid());
  $tmp_dir = isset($ucsc_config['tmp_dir']) ? rtrim($ucsc_config['tmp_dir'], '/') : '/tmp/chromozoom';
  $tmp_dir = preg_replace('/\\$USER\\b/', $pwu_data['name'], $tmp_dir);
  $tmp_dir = preg_replace('/\\$HOME\\b/', $pwu_data['dir'], $tmp_dir);
  if (!is_dir($tmp_dir)) { mkdir($tmp_dir, 0755, true); }
  return is_dir($tmp_dir) && is_writable($tmp_dir) ? $tmp_dir : FALSE;
}

function redirect_to_default_db($genomes) {
  $default = NULL;
  foreach ($genomes as $db => $_) {
    $pieces = explode(':', $db);
    if ($pieces[0] == 'ucsc' && file_exists(BASEDIR . "/UCSC_tracks/data/" . $pieces[1])) {
      $default = $db; break;
    }
  }
  $default = isset($_COOKIE['db']) ? $_COOKIE['db'] : $default;
  $db = isset($_GET['db']) ? $_GET['db'] : NULL;
  if ($db === NULL && $default !== NULL) { 
    header("Location: .?db=$default"); exit(); 
  }
}

// check that $_GET[$param] contains a valid URL, optionally translating cache:// URLs to local file paths
function validate_URL_in_GET_param($param, $allow_cache=FALSE) {
  if (!isset($_GET[$param])) { return FALSE; }
  $validator = $allow_cache ? '#^(https?|cache)://#' : '#^https?://#';
  $valid = preg_match($validator, $_GET[$param], $matches);
  if (!$valid) { return FALSE; }
  if ($valid && $allow_cache && $matches[1] == 'cache') {
    if (strpos($_GET[$param], '/../') !== FALSE) { return FALSE; } // prevents directory traversal shenanigans
    $_GET[$param] = preg_replace('#^cache://#', BASEDIR . "/", $_GET[$param]);
  }
  return $valid;
}

// This function takes a GET param containing a URL, e.g. 'url', and passes through HTTP Basic 
// Authentication parameters passed to this server if the URL's scheme, host and port match this server's.
function passthru_basic_auth_for_GET_param($param) {
  if (isset($_SERVER['PHP_AUTH_USER']) && isset($_GET[$param])) {
    $parsed_url = (parse_url($_GET['url']));
    $same_scheme = ($parsed_url["scheme"] == "http" && $_SERVER['HTTPS'] == '') 
        || ($parsed_url["scheme"] == "https" && $_SERVER['HTTPS'] !== '');
    $no_user = !isset($parsed_url["user"]);
    $same_user = $parsed_url["user"] === $_SERVER['PHP_AUTH_USER'];
    $no_password = !isset($parsed_url["pass"]);
    $same_host = $_SERVER["SERVER_NAME"] === $parsed_url["host"];
    $same_port = isset($parsed_url["port"]) ? $_SERVER["SERVER_PORT"] == $parsed_url["port"] : 
        ($_SERVER["SERVER_PORT"] == (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== '' ? 443 : 80));
    if ($same_scheme && $same_host && $same_port && ($no_user || ($same_user && $no_password))) {
      $user = rawurlencode($_SERVER['PHP_AUTH_USER']);
      $pass = rawurlencode($_SERVER['PHP_AUTH_PW']);
      $port = isset($parsed_url["port"]) ? ":{$_SERVER["SERVER_PORT"]}" : '';
      $_GET[$param] = "{$parsed_url["scheme"]}://$user:$pass@{$parsed_url["host"]}$port{$parsed_url["path"]}";
      if (isset($parsed_url["query"])) { $_GET[$param] .= "?{$parsed_url["query"]}"; }
      if (isset($parsed_url["fragment"])) { $_GET[$param] .= "#{$parsed_url["fragment"]}"; }
    }
  }
}