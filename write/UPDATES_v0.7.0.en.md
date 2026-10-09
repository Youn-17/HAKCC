# v0.7.0: Discussion analysis

Knowledge spaces add a dedicated page for word clouds, keyword changes, idea relay and open discussions. Filter the whole community or one student by view and date, inspect source Notes and return to the canvas. Word settings, anonymous display and PNG export are available.

Analysis uses student-authored Note text and adopted Build-on relations. Keyword changes group current text by Note creation date, rather than historical revisions. Frequencies do not measure mastery; open discussions require teacher inspection. Collaborative-document bodies are not included.

Optional course-material citation checks and draft scaffold suggestions are included. Deployers supply their own configuration and credentials.

Use Node 22 with npm ci and npm run build for the frontend and within api/ for the API. Text tools need Python, jieba, wordcloud and a Chinese-capable font. Idea relay and open discussions remain available without Python. No new database migration is required.

See [release checks](../evidence/RELEASE_VALIDATION.md) for validation limits. This public package excludes production configuration, real student records and internal operational documents.
