def check_braces(filepath):
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    
    stack = []
    line_no = 1
    col_no = 1
    for idx, char in enumerate(content):
        if char == "\n":
            line_no += 1
            col_no = 1
        else:
            col_no += 1
            
        if char == "{":
            stack.append((char, line_no, col_no))
        elif char == "}":
            if not stack:
                print(f"Unmatched close brace '}}' at line {line_no}, column {col_no}")
                return False
            stack.pop()
            
    if stack:
        print("Unmatched open braces remaining:")
        for char, line, col in stack:
            print(f"Brace '{char}' opened at line {line}, column {col}")
        return False
        
    print(f"All braces match successfully in {filepath}!")
    return True

check_braces(r"c:\Users\inbox_inm6dkz\OneDrive\Documents\GitHub\rjWebApp\styles.css")
