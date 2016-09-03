from lxml import html
import pymysql.cursors
import sqlite3
import urllib.request
import os, sys
import pymysql.cursors
import subprocess as sbp
import re
import json
import fileinput
import time

# Cache the parsed config file after the first access
config_yaml = None

def open_ucsc_yaml():
    global config_yaml
    if config_yaml is not None:
        return config_yaml
    try:
        import yaml
        with open('../ucsc.yaml', 'r') as handle:
            config_yaml = yaml.load(handle)
    except ImportError:
        sys.exit('FATAL: could not read ../config.yaml.')
    return config_yaml
    

def print_time():
    """
    :return: current time string
    """
    return time.strftime('%X %x')


def get_remote_table():
    cfg = open_ucsc_yaml()
    return cfg['browser_hosts']['authoritative'] + cfg['browser_urls']['tables']

def get_mysql_host():
    return open_ucsc_yaml()['browser_mysql']['authoritative']

def get_downloads_base_url():
    return open_ucsc_yaml()['data_urls']['downloads']

def get_downloads_table_tsv():
    return open_ucsc_yaml()['data_urls']['table_tsv']

# Check if a given executable is on $PATH
# For more on the `type` shell builtin, see https://bash.cyberciti.biz/guide/Type_command
def cmd_exists(cmd):
    return sbp.call("type " + cmd, shell=True, stdout=sbp.PIPE, stderr=sbp.PIPE) == 0


def get_tables(db='', tgroup='', xtrack='', table_source=''):
    mytree = html.parse("{}?db={}&hgta_group={}&hgta_track={}".format(table_source, db, tgroup, xtrack))
    search_taids = mytree.xpath('//select[@name="hgta_table"]/option/@value')
    search_tanames = [xel.strip() for xel in mytree.xpath('//select[@name="hgta_table"]/option/text()')]

    return dict(zip(search_taids, search_tanames))


def get_tracks(db='', tgroup='', table_source=''):
    mytree = html.parse("{}?db={}&hgta_group={}".format(table_source, db, tgroup))

    search_tids = mytree.xpath('//select[@name="hgta_track"]/option/@value')
    search_tnames = [xel.strip() for xel in mytree.xpath('//select[@name="hgta_track"]/option/text()')]

    return dict(zip(search_tids, search_tnames))


def get_groups(db='', table_source=''):
    """
    Returns dictionary of groups.
    """
    mytree = html.parse("{}?db={}".format(table_source, db))
    search_gids = mytree.xpath('//select[@name="hgta_group"]/option/@value')
    search_gnames = [xel.strip() for xel in mytree.xpath('//select[@name="hgta_group"]/option/text()')]
    groups_dict = dict(zip(search_gids, search_gnames))

    # remove all_tables and all tracks
    if 'allTables' in groups_dict:
        groups_dict.pop('allTables')
    if 'allTracks' in groups_dict:
        groups_dict.pop('allTracks')

    if db not in mytree.xpath('//select[@name="db"]/option/@value'):
        return None

    return groups_dict


def create_hierarchy(organism, table_source):
    """
    Creates a file with tables hierarchy for a given organism.
    """
    save_dir = './_hierarchy/'
    location = save_dir + '{}.txt'.format(organism)

    if not os.path.isdir(save_dir):
        os.mkdir(save_dir)
    if os.path.isfile(location):
        return location

    w_file = open(location, 'w')

    print('Organism: {}'.format(organism), file=w_file)
    org_groups = get_groups(organism, table_source=table_source)

    if not org_groups:
        w_file.close()
        os.remove(location)
        return None

    for group in org_groups:
        print('\tTrackgroup: {} ({})'.format(group, org_groups[group]), file=w_file)
        track_groups = get_tracks(organism, group, table_source)

        for track in track_groups:
            print('\t\tTrack: {} ({})'.format(track, track_groups[track]), file=w_file)
            tables = get_tables(organism, group, track, table_source)
            for table in tables:
                print('\t\t\tTable: {} ({})'.format(table, tables[table]), file=w_file)
    return location


def setup(organism):
    """
    Sets up directories and files needed for track fetching
    """

    # Build directory
    if not os.path.exists(organism):
        os.makedirs(organism)

    if not os.path.exists(organism + '/build'):
        os.makedirs(organism + '/build')

    if not os.path.exists(organism + '/bigBed'):
        os.makedirs(organism + '/bigBed')


def qups(in_cmd, ucur):
    """
    Executes mySQL query and returns parsed results
    """
    ucur.connection.ping(reconnect=True)
    ucur.execute(in_cmd)
    return ucur.fetchall()


def get_update_time(xcur, db, table_name):
    """
    Fetches table update time
    """
    return str(qups(("SELECT UPDATE_TIME FROM information_schema.tables "
                     "WHERE TABLE_SCHEMA='{}' AND TABLE_NAME='{}'").format(db, table_name), xcur)[0][0])


def get_numrows(xcur, table_name):
    return qups("SELECT COUNT(*) FROM {}".format(table_name), xcur)[0][0]


def fetch_as_file(bed_location, xcur, table_name):
    """
    Creates an auto_sql file and returns its location
    """

    as_file = bed_location[:-4] + '.as'
    as_contents = qups('SELECT autoSqlDef FROM tableDescriptions WHERE tableName="{}";'.format(table_name),
                      xcur)[0][0].decode()

    # Column bin removal
    bin_rows = re.compile('[\t\s]*(short|uint|string|ushort)[\t\s]+bin;')
    if bin_rows.search(as_contents):
        as_contents = '\n'.join([line for line in as_contents.split('\n') if not bin_rows.match(line)])

    old_colors = 'uint itemRgb;'
    if old_colors in as_contents:
        replace_line = '    uint reserved;     "Used as itemRgb as of 2004-11-22"'
        as_contents = '\n'.join([replace_line if old_colors in line else line for line in as_contents.split('\n')])

    w_file = open(as_file, 'w')
    w_file.write(as_contents)

    return as_file


def fetch_table_fields(xcur, table_name):
    return [val[0] for val in qups("SHOW columns FROM {}".format(table_name), xcur)]


def fix_bed_as_files(blocation, btype):
    """
    Tries to fix Bed auto_sql if initial BigBed building failed
    """
    def_types = ['string', 'uint', 'uint', 'string', 'uint', 'char[1]', 'uint', 'uint', 'uint']
    def_names = ['chrom', 'chromStart', 'chromEnd', 'name', 'score', 'strand', 'thickStart', 'thickEnd', 'reserved']
    bed_num = int(re.findall(r'\d+', btype)[0])
    as_file = blocation[:-4] + '.as'
    all_lines = open(as_file, 'r').read().split('\n')
    elements_lines = all_lines[3:][:bed_num]

    # Set default names and types
    for dtype, dname, eline, lnum in zip(def_types, def_names, elements_lines, range(3, 16)):
        all_lines[lnum] = (dtype + ' ' + eline.split(maxsplit=1)[1])

        lin1, lin2 = eline.split(';', maxsplit=1)
        lin1 = lin1.rsplit(maxsplit=1)
        lin1[1] = dname
        all_lines[lnum] = '; '.join([' '.join(lin1), lin2])

    open(as_file, 'w').write('\n'.join(all_lines))

    # Repair maximum and minimum score
    if bed_num >= 5:
        for line in fileinput.input(blocation, inplace=True):
            line = line.strip().split('\t')
            if int(line[4]) > 1000:
                line[4] = '1000'
            if int(line[4]) < 0:
                line[4] = '0'
            print('\t'.join(line))


def generate_big_bed(organism, btype, as_file, b_file):
    """
    Generates BigBed file. Make sure you have 'fetchChromSizes' and 'bedToBigBed' in your $PATH
    """
    if not cmd_exists('fetchChromSizes'):
        sys.exit("FATAL: must have fetchChromSizes installed on $PATH")
    if not cmd_exists('bedToBigBed'):
        sys.exit("FATAL: must have bedToBigBed installed on $PATH")
        
    bb_file = organism + '/bigBed/' + os.path.basename(b_file)[:-4] + '.bb'

    if not os.path.isfile("./{0}/build/chsize.txt".format(organism)):
        command = 'fetchChromSizes "{0}" > "./{0}/build/chsize.txt" 2>/dev/null'.format(organism)
        try:
            sbp.check_call(command, shell=True)
        except sbp.CalledProcessError:
            print('FAILED: Couldn\'t fetch chromosome info')
            return None

    # FIXME: Add -extraIndex parameter here for name field
    command = ('bedToBigBed -type="{1}" -as="{2}" -tab "{3}" "./{0}/build/chsize.txt" '
               '"{4}"').format(organism, btype, as_file, b_file, bb_file)
    try:
        sbp.check_call(command, shell=True)
        print('DONE ({}): Constructed "{}" BigBed file for organism "{}"'.format(print_time(), bb_file, organism))
    except sbp.CalledProcessError:
        print(('FAILED ({}): Couldn\'t construct "{}" BigBed file for organism "{}". '
              'Used command: `{}`').format(print_time(), organism, bb_file, command))
        return None

    return bb_file


def fetch_bed_table(host, xcur, table_name, organism, bedlike_format=None):
    """
    Uses mySQL query to fetch columns from bed file
    """
    gz_file = './{}/build/{}.txt.gz'.format(organism, table_name)
    location = './{}/build/{}.bed'.format(organism, table_name)
    has_bin_column = fetch_table_fields(xcur, table_name)[0] == 'bin'
    cut_bin_column = '| cut -f 2- ' if has_bin_column else ''

    url = get_downloads_table_tsv() % (organism, table_name)
    # Note: formerly, we attempted to fetch the data via MySQL, but this would time out for large tables
    # command = ("mysql -N -A -u genome -h {} -e 'SELECT {} FROM {}' {} >'{}' "
    #            "2>/dev/null").format(host, headers, table_name, organism, location)
    # The most robust fetching method is rsync.
    
    if cmd_exists('rsync'):
        command = "rsync -avzP --timeout=30 '{}' '{}'".format(url, os.path.dirname(gz_file))
    else:
        url = re.sub(r'^rsync://', 'http://', url)
        command = "curl '{}' --output '{}'".format(url, gz_file)
    
    returncode = None
    retries = 3
    while returncode != 0 and retries > 0:
        try:
            sbp.check_call(command, shell=True)
        except sbp.CalledProcessError as err:
            returncode = err.returncode
            retries -= 1
        returncode = 0
    
    if bedlike_format == 'genePred':
        awk_script = """
        {
          split($11, chromEnds, ",")
          split($10, chromStarts, ",")
          for (i = 1; i <= $9; i++) {
              exonSizes[i] = chromEnds[i] - chromStarts[i]
              exonStarts[i] = chromStarts[i] - $5
          }
          blockSizes = exonSizes[1]
          blockStarts = exonStarts[1]
          for (i = 2; i <= $9; i++) {
              blockSizes = blockSizes "," exonSizes[i]
              blockStarts = blockStarts "," exonStarts[i]
          }
          print ($3, $5, $6, $2, $12 + 0, $4, $7, $8, "0", $9, blockSizes, blockStarts)
        }
        """
        # FIXME: Also add name2, cdsStartStat, cdsEndStat, and exonFrames into a bed12+4 if available
        # See https://genome.ucsc.edu/goldenPath/help/bigGenePred.html
        if not has_bin_column:
            awk_script = re.sub(r'\$(\d+)\b', lambda m: '$' + str(int(m.group(1)) - 1), awk_script)
        command = "cat '{}' | zcat | awk -v OFS=\"\\t\" '{}' | sort -k1,1 -k2,2n >'{}'".format(gz_file, awk_script, location)
    elif bedlike_format == 'psl':
        if not cmd_exists('pslToBigPsl'):
            sys.exit("FATAL: must have pslToBigPsl installed on $PATH")
        command = "cat '{}' | zcat {}| pslToBigPsl /dev/stdin stdout | sort -k1,1 -k2,2n >'{}'".format(gz_file, 
                                                                                                    cut_bin_column, location)
    elif bedlike_format is None:
        command = "cat '{}' | zcat {}>'{}'".format(gz_file, cut_bin_column, location)
    else:
        print('FAILED ({}): [db {}] "{}" {} conversion to BED not handled.'.format(print_time(), organism, table_name, 
                                                                                    bedlike_format))
        return None
    
    try:
        sbp.check_call(command, shell=True)
        os.remove(gz_file)
        print('DONE ({}): [db {}] Fetched "{}" into a BED file'.format(print_time(), organism, table_name))
    except sbp.CalledProcessError:
        print('FAILED ({}): [db {}] Couldn\'t fetch "{}" as a BED file.'.format(print_time(), organism, table_name))
        print(command)
        return None
    
    return location


def fetch_tracks(host=None, db_name='hg19', xcur=None, selection=None):
    """
    Fetches all tracks from UCSC specified database
    :return:
    """
    if xcur is None:
        xconn = pymysql.connect(host=host, user='genome', database=db_name)
        xcur = xconn.cursor()     # get the cursor

    if selection:
        # the trackDb table drops the "all_" prefix for certain tables, like all_mrna and all_est
        # so we have to fix that here and then set it back (?)
        fixed_selection = [re.sub(r'^all_', '', element) for element in selection]
        in_clause = ','.join(['"' + element + '"' for element in fixed_selection])
        tracks = qups(("SELECT tableName, type, grp, shortLabel, longLabel, html, settings "
                     "FROM trackDb WHERE tableName in ({}) ORDER BY tableName").format(in_clause), xcur)
    else:
        tracks = qups(("SELECT tableName, type, grp, shortLabel, longLabel, html, settings "
                     "FROM trackDb ORDER BY tableName"), xcur)
    
    tracks = [list(track) for track in tracks]
    for track in tracks:
        if "all_" + track[0] in selection:
            track[0] = "all_" + track[0]
    
    return tracks


def create_sqllite3_db(xorganism):
    """
    Checks if DB is created and
    if not create it.
    Returns DB location.
    """
    db_loc = './{}/tracks.db'.format(xorganism)

    new_db = True
    if os.path.isfile(db_loc):
        new_db = False

    xconn = sqlite3.connect(db_loc)
    c = xconn.cursor()
    if new_db:
        c.execute("CREATE TABLE tracks (name, displayName, type, trackGroup, track, shortLabel, longLabel, location,"
                  " html longblob, updateDate)")
    return db_loc, c, xconn


def filter_extractable_dbs(wanted_tracks, xcur):
    """
    Checks which tracks can be extracted from UCSC
    databases and returns a list of those
    """
    track_data = set([table[0] for table in qups("SELECT tableName FROM trackDb", xcur)])
    # Allow some tables, like mrna, and est, to by prefixed by "all_"
    track_data = track_data | set(["all_" + track for track in track_data])
    tracks_tables = set([table[0] for table in qups("SHOW TABLES", xcur)])
    extractable = track_data & tracks_tables & set(wanted_tracks)
    return sorted(extractable)


def get_organisms_list(url='http://beta.chromozoom.org/php/chromsizes.php', prefix=''):
    """
    Get list of organisms
    """

    with urllib.request.urlopen(url) as response:
        my_html = response.read().decode()
        my_html = json.loads(my_html)

    org_names = [organism['name'] for organism in my_html]
    if prefix != '':
        org_names = [name for name in org_names if name.startswith(prefix)]
    
    return org_names
