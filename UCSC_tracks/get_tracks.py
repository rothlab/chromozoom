import lib.buildfunctions as buildfun
import pymysql.cursors
import os
import argparse
import time


parser = argparse.ArgumentParser(description='Fetch tracks from UCSC table browser and construct BigBed files.')
parser.add_argument('--all', action='store_true', default=False,
                    help='Load all tables from UCSC.')
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

    # Try connecting to a database
    try:
        conn = pymysql.connect(host=mysql_host, user='genome', database=organism)
        cur = conn.cursor()
    except pymysql.err.InternalError:
        print('WARNING ({}): No MySQL tables found for "{}". Omitting.'.format(buildfun.print_time(), organism))
        continue
    buildfun.setup(organism)

    all_tracks = []
    track_info = dict()

    with open(track_meta, 'r') as handle:
        for line in handle:
            if 'Trackgroup: ' in line:
                c_tgroupname = line.split('(', 1)[1][:-2]
            elif 'Track:' in line:
                c_track = line.split()[1]
                c_trackname = line.split('(', 1)[1][:-2]
            elif 'Table:' in line and (c_track == line.split()[1] or args.all):
                c_table = line.split()[1]
                all_tracks.append(c_table)
                track_info[c_table] = (line.split('(', 1)[1][:-2], c_trackname, c_tgroupname)

    process_tracks = buildfun.filter_extractable_dbs(all_tracks, cur)
    local_db, localcur, localconn = buildfun.create_sqllite3_db(organism)
    my_tracks = buildfun.fetch_tracks(host=mysql_host, db_name=organism, xcur=cur, selection=process_tracks)

    localcur.execute('SELECT name, updateDate FROM tracks;')
    last_updates = dict(localcur.fetchall())

    for tablename, dbtype, group, shortLabel, longLabel, htmlDescription, settings in my_tracks:
        save_to_db = False
        update_date = buildfun.get_update_time(cur, organism, tablename)

        # check if we need to update the table
        if tablename in last_updates:
            if last_updates[tablename] == update_date:
                print('INFO ({}): data for table "{}" is up to date. Organism: {}'.format(buildfun.print_time(),
                                                                                          tablename, organism))
                continue
            else:
                print('INFO ({}): Updating table "{}". Organism: {}'.format(buildfun.print_time(), tablename, organism))
                localcur.execute('DELETE FROM tracks WHERE name="{}";'.format(tablename))

        # BigWig and Bam processing
        if dbtype.startswith('bigWig ') or dbtype == 'bam':
            file_location = buildfun.qups("SELECT fileName FROM {}".format(tablename), cur)

            if len(file_location) > 1:
                print('WARNING ({}): Multiple files are associated with "{}" "({})" file. Organism: "{}"'
                      .format(buildfun.print_time(), tablename, dbtype, organism))
            file_location = downloads_base_url + file_location[0][0]
            print('DONE ({}): Fetched remote location for "{}" "{}" file. Organism: "{}"'.format(buildfun.print_time(),
                                                                                                 tablename, dbtype,
                                                                                                 organism))
            save_to_db = True

        # Bed processing
        elif dbtype.startswith('bed '):
            bed_location = buildfun.fetch_bed_table(mysql_host, cur, tablename, organism)
            if bed_location is None:
                continue
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
            os.remove(as_location)
            save_to_db = True
        else:
            continue

        if save_to_db:
            command = 'INSERT INTO tracks VALUES (?,?,?,?,?,?,?,?,?,?)'
            localcur.execute(command, (tablename, track_info[tablename][0], dbtype, track_info[tablename][2],
                                       track_info[tablename][1], shortLabel, longLabel, file_location, htmlDescription,
                                       update_date))
        localconn.commit()
        time.sleep(10)
