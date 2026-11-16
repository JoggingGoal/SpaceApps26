# Publish The Green Revolution without Codespaces

1. Download and EXTRACT the deployment ZIP on your computer.
2. Open https://github.com/JoggingGoal/SpaceApps26 and choose **Add file → Upload files**.
3. Drag the extracted project CONTENTS (not the ZIP and not the containing folder) onto GitHub.
   The repo root must show `app.py`, `index.html`, `render.yaml`, `HOME`, `MAP`, `SCIENTIFIC_INFO`, `SIMULATIONS`, `assets`.
4. Commit to `main`.
5. Open https://dashboard.render.com/ and sign in with GitHub.
6. Choose **New → Web Service**, connect `JoggingGoal/SpaceApps26` and `main`.
7. Runtime: Python. Root directory: repository root (blank). Plan: Free.
   Build command: `python3 -m compileall -q app.py farmwise_backend.py`
   Start command: `python3 app.py`
8. Deploy. Once Live, open the `https://<your-service>.onrender.com/` link.
9. Check `/api/health`, the homepage, Explore the Land, Science, Simulator and a real NASA request.

Do not share the GitHub repo link as though it's the public live site.
Notes: The free Render web service sleeps after 15 minutes without traffic and may take ~1 minute to wake. Live NASA services need outbound access. This is a prototype, not a production deployment.
