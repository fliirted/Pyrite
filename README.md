# JSthon ![version](https://img.shields.io/badge/version-2.0.0-yellow)

JSthon is a lightweight Python interpreter written in JavaScript that runs directly in the browser. It features a custom lexical tokenizer and an environment-based scoping system to mimic Python's execution model.

### Quick Start

Integrate JSthon into any web project with just a few lines of HTML:

```html
<textarea id="editor">print("Hello, JSthon!")</textarea>
<div id="console"></div>

<button onclick="runCompiler()">Execute Code</button>

<script src="https://cdn.jsdelivr.net/gh/fliirted/jsthon/dist/jsthon.min.js"></script>
```

### Features
- **Variables & Scoping:** Full support for `global` and `nonlocal` keywords.
- **Functions & Closures:** Nested function support with lexical scoping.
- **Control Flow:** Implementation of `if/elif/else`, `while` loops, and `for ... in` ranges.
- **Lists:** Support for concatenation (`+`), indexing, and slicing.
- **F-Strings:** Python string interpolation (e.g., `f"Value: {x}"`).
- **Interactive:** Built-in `input()` function with inline prompts.
- **Attributes:** Many attributes are now supported (e.g., `.upper()`, `.len()`, `.append()`)
- **Errors:** Python style tracebacks.

### Architecture
JSthon operates in three main stages:
1. **Tokenizer:** Uses regex to convert raw text into a stream of symbols.
2. **Environment:** A recursive tree structure managing variable bindings and scope inheritance.
3. **Evaluator:** An asynchronous engine handling blocks, function calls, and operator precedence.

### Example Script
```python
def make_counter(n):
    count = n
    def increment():
        nonlocal count
        count += 1
        return count
    return increment

counter = make_counter(10)
print(f"Next value: {counter()}")
```

### In Construction
- **Dot Notation:** Full support for object and string methods (e.g., `.staticmethod()`, `.classmethod()`, `.property()`. Many are now supported).
- **Dictionaries:** Implementation of key-value pair data structures.
- **Error Handling:** More descriptive Tracebacks and `try/except` blocks.
- **Modules:** A system to `import` external JSthon scripts.

### Version Notation
`Major.Minor.Patch`


### License
This project is licensed under the MIT License.