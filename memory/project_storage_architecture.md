---
name: project-storage-architecture
description: Architectural principle for how account data is stored — unified model regardless of import method
metadata:
  type: project
---

All portfolio-type accounts should share the same storage structure. Import method (Plaid, SnapTrade, manual UI, file import) is just the mechanism to populate data — once stored, all accounts are treated identically.

**Why:** Makes accounts easy to maintain and update going forward, agnostic to how data was first created.

**How to apply:** When adding new import methods, map extracted data to the existing canonical storage format (currently ManualPortfolio for non-connected accounts) rather than creating new storage types. Metadata about import source can be added as optional fields on the shared type.
