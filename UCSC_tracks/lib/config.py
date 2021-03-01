import os, sys
import logging as log

# Cache the parsed config file after the first access
config_yaml = None

def _open_ucsc_yaml():
    global config_yaml
    if config_yaml is not None:
        return config_yaml
    try:
        import yaml
        with open(os.path.join(os.path.dirname(__file__), '../../ucsc.yaml'), 'r') as handle:
            config_yaml = yaml.load(handle)
    except (ImportError, FileNotFoundError) as e:
        log.critical('Could not read ../ucsc.yaml. Exiting.')
        sys.exit(64)
    return config_yaml

def ucsc_base_url():
    return _open_ucsc_yaml()['browser_hosts']['authoritative']

def remote_table():
    return ucsc_base_url() + _open_ucsc_yaml()['browser_urls']['tables']

def mysql_host():
    return _open_ucsc_yaml()['browser_mysql']['authoritative']

def downloads_base_url():
    return _open_ucsc_yaml()['data_urls']['downloads']

def downloads_table_tsv():
    return _open_ucsc_yaml()['data_urls']['table_tsv']

def downloads_chrom_sizes():
    return _open_ucsc_yaml()['data_urls']['chrom_sizes']

def downloads_chrom_info():
    return _open_ucsc_yaml()['data_urls']['chrom_info']
    
def wig_as_bigwig():
    return _open_ucsc_yaml()['data_urls']['wig_as_bigwig']
    
def downloads_wib():
    return _open_ucsc_yaml()['data_urls']['wib']

def remote_tracks():
    return ucsc_base_url() + _open_ucsc_yaml()['browser_urls']['tracks']

def remote_item_url():
    return ucsc_base_url() + _open_ucsc_yaml()['browser_urls']['item_detail']