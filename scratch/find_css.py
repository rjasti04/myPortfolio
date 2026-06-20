import os

js_dir = r"c:\Users\inbox_inm6dkz\OneDrive\Documents\GitHub\rjWebApp\js"

for root, dirs, files in os.walk(js_dir):
    for file in files:
        if file.endswith(".js"):
            path = os.path.join(root, file)
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()
            if "compactViewport" in content:
                print(f"Found compactViewport in: {file}")
