with open(r"c:\Users\inbox_inm6dkz\OneDrive\Documents\GitHub\rjWebApp\styles.css", "r", encoding="utf-8") as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if ".btn" in line or "hero-buttons" in line or "hero-chat-btn" in line:
        print(f"Line {i+1}: {line.strip()}")

