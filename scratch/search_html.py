import os

root_dir = r"c:\Users\inbox_inm6dkz\OneDrive\Documents\GitHub\rjWebApp"

for file in os.listdir(root_dir):
    if file.endswith(".html"):
        path = os.path.join(root_dir, file)
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        for term in ["header-datetime", "header-locweather", "header-actions"]:
            if term in content:
                print(f"Found '{term}' in {file}")
