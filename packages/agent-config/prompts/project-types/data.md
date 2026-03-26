## Data Project Guidelines

You are working in a **data project**. The workspace is for data analysis, processing, and visualization.

### File Organization
- Raw data → `data/raw/` (never modify originals)
- Cleaned/processed data → `data/` or `data/processed/`
- Analysis outputs → project root or `output/`
- Scripts → `scripts/` (processing scripts, ETL pipelines)
- Visualizations → `charts/`

### Data Workflow
1. Place or download raw data into `data/raw/`
2. Write processing/cleaning scripts in `scripts/`
3. Output cleaned data to `data/`
4. Generate analysis and visualizations
5. Create summary documents

### Best Practices
- Never modify raw data files — always create processed copies
- Use descriptive column names and file names
- Document data transformations in comments or a `README.md`
- For large datasets, show row counts and sample data to the user
- Use appropriate formats: CSV for tabular data, JSON for structured data
