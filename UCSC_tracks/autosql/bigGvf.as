table bigGvf
"A compromise between Genome Variation Format and BED format."
    (
    string chrom;                 "Reference sequence chromosome or scaffold"
    uint   chromStart;            "Start position in chromosome"
    uint   chromEnd;              "End position in chromosome"
    string name;                  "Name or ID of item, ideally both human readable and unique"
    uint score;                   "Score (0-1000)"
    char[1] strand;               "+ or - for strand"
    uint thickStart;              "Start of where display should be thick (start codon)"
    uint thickEnd;                "End of where display should be thick (stop codon)"
    uint attrCount;               "Number of attributes saved in the attrTags and attrVals fields"
    string[attrCount] attrTags;   "List of tag names extracted from the variant record in the original GVF format"
    string[attrCount] attrVals;   "List of values extracted from the variant record in the original GVF format"
    )
