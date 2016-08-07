from lxml import html
import pymysql.cursors
import sqlite3
import urllib.request
import os
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


def fetch_as_file(blocation, xcur, table_name):
    """
    Creates an auto_sql file and returns its location
    """

    as_file = blocation[:-4] + '.as'
    asseq_cont = qups('SELECT autoSqlDef FROM tableDescriptions WHERE tableName="{}";'.format(table_name),
                      xcur)[0][0].decode()

    # Column bin removal
    bin_rows = re.compile('[\t\s]*(short|uint|string|ushort)[\t\s]+bin;')
    if bin_rows.search(asseq_cont):
        asseq_cont = '\n'.join([line for line in asseq_cont.split('\n') if not bin_rows.match(line)])

    old_colors = 'uint itemRgb;'
    if old_colors in asseq_cont:
        replace_line = '    uint reserved;     "Used as itemRgb as of 2004-11-22"'
        asseq_cont = '\n'.join([replace_line if old_colors in line else line for line in asseq_cont.split('\n')])

    w_file = open(as_file, 'w')
    w_file.write(asseq_cont)

    return as_file


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
               '"{4}" 2>/dev/null 1>&2').format(organism, btype, as_file, b_file, bb_file)
    try:
        sbp.check_call(command, shell=True)
        print('DONE ({}): Constructed "{}" BigBed file for organism "{}"'.format(print_time(), bb_file, organism))
    except sbp.CalledProcessError:
        print(('FAILED ({}): Couldn\'t construct "{}" BigBed file for organism "{}". '
              'Used command: `{}`').format(print_time(), organism, bb_file, command))
        return None

    return bb_file


def fetch_bed_table(host, xcur, table_name, organism):
    """
    Uses mySQL query to fetch columns from bed file
    """
    location = './{}/build/{}.bed'.format(organism, table_name)
    headers = ', '.join([val[0] for val in qups("SHOW columns FROM {}".format(table_name), xcur) if val[0] != 'bin'])

    # TODO: Use limit in case of testing
    # FIXME: Replace this with downloading the .txt.gz files from 
    #        http://hgdownload.cse.ucsc.edu/goldenpath/{organism}/database/
    #        which are gzip'ed tab-delimited versions of these tables.
    #        Can use `gzcat | awk` to rearrange the columns of these files, e.g. for a genePred track
    #          gzcat refGene.txt.gz | awk -v OFS="\t" '{
    #              split($11, exonEnds, ",")
    #              split($10, exonStarts, ",")
    #              for (i = 1; i <= $9; i++)
    #                exonSizes[i] = exonEnds[i] - exonStarts[i]
    #              blockSizes = exonSizes[1]
    #              for (i = 2; i <= $9; i++)
    #                blockSizes = blockSizes "," exonSizes[i]
    #              sub(/,$/, "", $10)
    #              print ($3, $5, $6, $2, $12, $4, $7, $8, "", $9, blockSizes, $10)
    #            }'
    #        or, to just clip off the "bin" field, `gzcat | cut`
    #          gzcat stsMap.txt.gz | cut -f 2-
    command = ("mysql -N -A -u genome -h {} -e 'SELECT {} FROM {}' {} >'{}' "
               "2>/dev/null").format(host, headers, table_name, organism, location)
    try:
        sbp.check_call(command, shell=True)
        print('DONE ({}): Fetched "{}" BED file for organism "{}"'.format(print_time(), table_name, organism))
    except sbp.CalledProcessError:
        print('FAILED ({}): couldn\'t fetch "{}" BED file for organism "{}"'.format(print_time(), table_name,
                                                                                    organism))
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
        selection = ','.join(['"' + element + '"' for element in selection])
        return qups(("SELECT tableName, type, grp, shortLabel, longLabel, html, settings "
                     "FROM trackDb WHERE tableName in ({})").format(selection), xcur)
    return qups(("SELECT tableName, type, grp, shortLabel, longLabel, html, settings "
                 "FROM trackDb"), xcur)


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
    tracks_tables = set([table[0] for table in qups("SHOW TABLES", xcur)])
    extractable = track_data & tracks_tables
    return [track for track in wanted_tracks if track in extractable]


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
