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


def get_tables(db='', tgroup='', xtrack=''):
    mytree = html.parse("http://genome.ucsc.edu/cgi-bin/hgTables?db={}&hgta_group={}&hgta_track={}".format(db, tgroup,
                                                                                                           xtrack))
    search_taids = mytree.xpath('//select[@name="hgta_table"]/option/@value')
    search_tanames = [xel.strip() for xel in mytree.xpath('//select[@name="hgta_table"]/option/text()')]

    return dict(zip(search_taids, search_tanames))


def get_tracks(db='', tgroup=''):
    mytree = html.parse("http://genome.ucsc.edu/cgi-bin/hgTables?db={}&hgta_group={}".format(db, tgroup))

    search_tids = mytree.xpath('//select[@name="hgta_track"]/option/@value')
    search_tnames = [xel.strip() for xel in mytree.xpath('//select[@name="hgta_track"]/option/text()')]

    return dict(zip(search_tids, search_tnames))


def get_groups(db=''):
    """
    Returns dictionary of groups.
    """
    mytree = html.parse("http://genome.ucsc.edu/cgi-bin/hgTables?db={}".format(db))

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


def create_hirarchy(organism):
    """
    Creates a file with tables hirarchy for a given organism.
    """
    location = 'table_hirarchy_{}.txt'.format(organism)
    w_file = open(location, 'w')

    print('Organism: {}'.format(organism), file=w_file)
    org_groups = get_groups(organism)
    if not org_groups:
        return None

    for group in org_groups:
        print('\tTrackgroup: {} ({})'.format(group, org_groups[group]), file=w_file)
        track_groups = get_tracks(organism, group)

        for track in track_groups:
            print('\t\tTrack: {} ({})'.format(track, track_groups[track]), file=w_file)
            tables = get_tables(organism, group, track)
            for table in tables:
                print('\t\t\tTable: {} ({})'.format(table, tables[table]), file=w_file)
    return location


def setup(sorganism):
    """
    Sets up directories and files needed for track fetching
    """

    # Build directory
    if not os.path.exists(sorganism):
        os.makedirs(sorganism)

    if not os.path.exists(sorganism + '/build_dir'):
        os.makedirs(sorganism + '/build_dir')

    if not os.path.exists(sorganism + '/bigBed_dir'):
        os.makedirs(sorganism + '/bigBed_dir')


def qups(in_cmd, ucur):
    """
    Executes mySQL query and returns parsed results
    """
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


def generate_big_bed(organims, btype, as_file, b_file):
    """
    Generates BigBed file. Make sure you have 'fetchChromSizes' and 'bedToBigBed' in your $PATH
    """
    bb_file = organims + '/bigBed_dir/' + os.path.basename(b_file)[:-4] + '.bb'

    if not os.path.isfile("./{0}/build_dir/chsize.txt".format(organims)):
        command = 'fetchChromSizes "{0}" > "./{0}/build_dir/chsize.txt" 2>/dev/null'.format(organims)
        try:
            sbp.check_call(command, shell=True)
        except sbp.CalledProcessError:
            print('FAILED: Couldn\'t fetch chromosome info')
            return None

    command = ('bedToBigBed -type="{1}" -as="{2}" -tab "{3}" "./{0}/build_dir/chsize.txt" '
               '"{4}" 2>/dev/null 1>&2').format(organims, btype, as_file, b_file, bb_file)
    try:
        sbp.check_call(command, shell=True)
        print('DONE: constructed "{}" BigBed file for organims "{}"'.format(organims, bb_file))
    except sbp.CalledProcessError:
        print(('FAILED: Couldn\'t construct "{}" BigBed file for organims "{}". '
              'Used command: "{}"').format(organims, bb_file, command))
        return None

    return bb_file


def fetch_bed_table(xcur, table_name, sorganism):
    """
    Uses mySQL query to fetch columns from bed file
    """
    location = './{}/build_dir/{}.bed'.format(sorganism, table_name)
    headers = ', '.join([val[0] for val in qups("SHOW columns FROM {}".format(table_name), xcur) if val[0] != 'bin'])

    # TODO: Use limit in case of testing
    command = ("mysql -N -A -u genome -h genome-mysql.cse.ucsc.edu  -e 'Select {} from {}' {} >\"{}\" "
               "2>/dev/null").format(headers, table_name, sorganism, location)
    try:
        sbp.check_call(command, shell=True)
        print('DONE: Fetched "{}" Bed file for organims "{}"'.format(table_name, sorganism))
    except sbp.CalledProcessError:
        print('FAILED: couldn\'t fetch "{}" Bed file for organims "{}"'.format(table_name, sorganism))
        print(command)
        return None
    return location


def fetch_tracks(db_name='hg19', xcur=None, selection=None):
    """
    Fetches all tracks from UCSC specified database
    :return:
    """
    if xcur is None:
        xconn = pymysql.connect(host='genome-mysql.cse.ucsc.edu', user='genome', database=db_name)
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
    track_data = set([tabl[0] for tabl in qups("SELECT tableName FROM trackDb", xcur)])
    tracks_tables = set([tabl[0] for tabl in qups("SHOW TABLES", xcur)])
    extractable = track_data & tracks_tables
    return [track for track in wanted_tracks if track in extractable]


def get_organisms_list(url='http://beta.chromozoom.org/php/chromsizes.php'):
    """
    Get list of organisms
    """
    urllib.request.urlopen('http://python.org/')

    with urllib.request.urlopen(url) as response:
        my_html = response.read().decode()
        my_html = json.loads(my_html)

    return [organ['name'] for organ in my_html]