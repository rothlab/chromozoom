table repeatMasker
"RepeatMasker output; see http://www.repeatmasker.org/webrepeatmaskerhelp.html#reading."
    (
    string chrom;       "Reference sequence chromosome or scaffold"
    uint   chromStart;  "Start position in chromosome"
    uint   chromEnd;    "End position in chromosome"
    string name;        "Name of the matching interspersed repeat"
    uint score;         "Score (0-1000), which we calculate here as max(1000-milliDiv-milliDel-milliIns, 0)"
    char[1] strand;     "+ or - for strand"
    string repClass;    "The class of the repeat; see http://www.girinst.org/repbase/update/browse.php"
    string repFamily;   "The family of the repeat; see http://www.girinst.org/repbase/update/browse.php"
    float pctSubst;     "% substitutions in matching region compared to the consensus"
    float pctDel;       "% of bases opposite a gap in the query sequence (deleted bp)"
    float pctIns;       "% of bases opposite a gap in the repeat consensus (inserted bp)"
    uint swScore;       "Smith-Waterman score of the match, usually complexity adjusted. NOTE: SW scores are not always directly comparable, depending on complexity adjustment and the scoring matrix used."
    )
