<?php
  
function not_symlinked_or_found_on_path($bin) {
  $symlink = dirname(dirname(__FILE__)) . '/bin/' . $bin;
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

function where_is_ucsc_yaml() {
  $ucsc_dist_yaml = dirname(dirname(__FILE__)) . "/ucsc.dist.yaml";
  $ucsc_yaml = dirname(dirname(__FILE__)) . "/ucsc.yaml";
  return file_exists($ucsc_yaml) ? $ucsc_yaml : $ucsc_dist_yaml;
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