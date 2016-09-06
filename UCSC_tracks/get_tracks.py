import lib.buildfunctions as buildfun
import pymysql.cursors
import os
import argparse
import time
import sys
import re

parser = argparse.ArgumentParser(description='Fetch tracks from UCSC table browser and construct BigBed files.')
parser.add_argument('--composite_tracks', action='store_true', default=False,
                    help='Scrape both simple and composite tracks from UCSC (default is simple only).')
parser.add_argument('--priority_below', action='store', type=float, default=None,
                    help='Restrict scraping to tracks with calculated priority below this number (1-1000).')
parser.add_argument('--org_source', action='store', type=str, default='http://beta.chromozoom.org/php/chromsizes.php',
                    help='Location of organisms list in JSON format.')
parser.add_argument('--org_prefix', action='store', type=str, default='',
                    help='Restrict scraping to organism database names matching this prefix.')
parser.add_argument('--table_source', action='store', type=str, default='',
                    help='Location of Track tables. Leave blank to retrieve it from the ../ucsc.yaml config file')
parser.add_argument('--mysql_host', action='store', type=str, default='',
                    help='Hostname for UCSC\'s MySQL server. Leave blank to retrieve it from the ../ucsc.yaml config file')
parser.add_argument('--downloads_base_url', action='store', type=str, default='',
                    help='Base URL for bulk downloads from UCSC. Leave blank to retrieve it from the ../ucsc.yaml config file')
args = parser.parse_args()


table_source = buildfun.get_remote_table() if args.table_source == '' else args.table_source
tracks_source = buildfun.get_remote_tracks()
mysql_host = buildfun.get_mysql_host() if args.mysql_host == '' else args.mysql_host
downloads_base_url = buildfun.get_downloads_base_url() if args.downloads_base_url == '' else args.downloads_base_url
downloads_base_url = downloads_base_url.rstrip('/')


for organism in buildfun.get_organisms_list(args.org_source, args.org_prefix):
    print('#####################################')
    print('INFO ({}): FETCHING DATA FOR NEW ORGANISM: {}'.format(buildfun.print_time(), organism))
    print('INFO ({}): EXTRACTING TRACK HIERARCHY!'.format(buildfun.print_time()))
    track_meta = buildfun.create_hierarchy(organism, table_source)
    if not track_meta:
        print('WARNING ({}): No tables for {} found. Omitting.'.format(buildfun.print_time(), organism))
        continue

    # Try connecting to UCSC's MySQL database
    try:
        conn = pymysql.connect(host=mysql_host, user='genome', database=organism)
        cur = conn.cursor()
    except pymysql.err.InternalError:
        print('WARNING ({}): No MySQL tables found for "{}". Omitting.'.format(buildfun.print_time(), organism))
        continue
    buildfun.setup_directories(organism)

    selected_tracks, track_info = buildfun.distill_hierarchy(track_meta, args.composite_tracks)
    selected_tracks = buildfun.filter_extractable_dbs(selected_tracks, cur)
    track_priority = buildfun.get_priority(db=organism, selection=selected_tracks, tracks_source=tracks_source, 
                                           track_info=track_info)
    if args.priority_below is not None:
        selected_tracks = [t for t in selected_tracks if track_priority[t] <= args.priority_below]
    
    local_db, localcur, localconn = buildfun.create_sqllite3_db(organism)
    last_updates = buildfun.get_last_local_updates(localcur)
    
    my_tracks = buildfun.fetch_tracks(host=mysql_host, db_name=organism, xcur=cur, selection=selected_tracks)
    my_tracks = sorted(my_tracks, key=lambda row: (track_info[row[0]]['parentTrack'], row[0]))

    for tablename, dbtype, group, shortLabel, longLabel, htmlDescription, settings in my_tracks:
        parent_track = track_info[tablename]['parentTrack']
        print('INFO ({}): [db {}] Checking table "{}", track {}.'.format(buildfun.print_time(), organism, tablename, parent_track))
        save_to_db = False
        update_date = buildfun.get_update_time(cur, organism, tablename)
        bedlike_format = re.match(r'^(genePred|psl)\b', dbtype)
        bedlike_format = bedlike_format and bedlike_format.group(1)

        # check if we need to update the table
        if tablename in last_updates:
            if last_updates[tablename] == update_date:
                print('INFO ({}): [db {}] data for table "{}" is up to date.'.format(buildfun.print_time(),
                                                                                          organism, tablename))
                continue
            else:
                print('INFO ({}): [db {}] Updating table "{}".'.format(buildfun.print_time(), organism, tablename))
                localcur.execute('DELETE FROM tracks WHERE name="{}";'.format(tablename))
        else:
            print('INFO ({}): [db {}] Need to fetch table "{}".'.format(buildfun.print_time(), organism, tablename))

        # bigWig, bigBed, and BAM processing
        if dbtype.startswith('bigWig ') or dbtype.startswith('bigBed ') or dbtype == 'bam':
            file_location = buildfun.qups("SELECT fileName FROM {}".format(tablename), cur)

            if len(file_location) > 1:
                print('WARNING ({}): [db {}] Multiple files are associated with "{}" "({})" file.'
                      .format(buildfun.print_time(), organism, tablename, dbtype))
            file_location = downloads_base_url + file_location[0][0]
            print('DONE ({}): [db {}] Fetched remote location for "{}" "{}" file.'.format(buildfun.print_time(),
                                                                                                 organism, tablename, 
                                                                                                 dbtype))
            save_to_db = True

        # BED, genePred, and PSL processing
        elif dbtype.startswith('bed ') or bedlike_format:
            bed_location = buildfun.fetch_bed_table(mysql_host, cur, tablename, organism, bedlike_format)
            if bed_location is None:
                continue
            if bedlike_format == 'genePred':
                as_location = 'autosql/genePredFull.as'
                bedtype = 'bed12+8'
            elif bedlike_format == 'psl':
                as_location = 'autosql/bigPsl.as'
                bedtype = 'bed12+12'
            else:
                as_location = buildfun.fetch_as_file(bed_location, cur, tablename)
                bedtype = dbtype.replace(' ', '').rstrip('.') 
            file_location = buildfun.generate_big_bed(organism, bedtype, as_location, bed_location)

            # Try fixing autosql_file
            if file_location is None:
                try:
                    buildfun.fix_bed_as_files(bed_location, bedtype)
                    file_location = buildfun.generate_big_bed(organism, bedtype, as_location, bed_location)
                except:
                    pass
            if file_location is None:
                continue

            # Delete successful builds
            os.remove(bed_location)
            if not as_location.startswith('autosql/'): os.remove(as_location)
            save_to_db = True
        
        elif dbtype.startswith('wig '):
            print('ERROR: skipping for now, TODO!')
            # Can simply link to http://hgdownload.cse.ucsc.edu/goldenPath/hg38/{phyloP,phast}{7,20,100}way/*.bw
            
        else:
            print('INFO ({}): [db {}] Unhandled dbtype "{}" for table "{}".'.format(buildfun.print_time(), organism,
                                                                                      dbtype, tablename))
            continue

        if save_to_db:
            row_vals = (tablename, track_info[tablename]['displayName'], dbtype, group, track_info[tablename]['groupLabel'], 
                    parent_track, track_info[tablename]['trackLabel'], shortLabel, longLabel, track_priority[tablename], 
                    file_location, htmlDescription, update_date)
            command = 'INSERT INTO tracks VALUES (' + (','.join(['?'] * len(row_vals))) + ')'
            localcur.execute(command, row_vals)
        localconn.commit()
