table narrowPeak
"Called peaks of signal enrichment based on pooled, normalized (interpreted) data."
    (
    string chrom;       "Reference sequence chromosome or scaffold"
    uint   chromStart;  "Start position in chromosome"
    uint   chromEnd;    "End position in chromosome"
    string name;        "Name or ID of item, ideally both human readable and unique"
    uint score;         "Score (0-1000)"
    char[1] strand;     "+ or - for strand"
    int signalValue;    "Measurement of overall (usually, average) enrichment for the region"
    float pValue;       "Measurement of statistical significance (-log10). Use -1 if no pValue is assigned."
    float qValue;       "Measurement of statistical significance using false discovery rate (-log10). Use -1 if no qValue is assigned."
    int peak;           "Point-source called for this peak; 0-based offset from chromStart. Use -1 if no point-source called."
    )
