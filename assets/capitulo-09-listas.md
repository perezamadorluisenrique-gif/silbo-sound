# Capítulo 9: Listas

<!-- modulo: m00065 -->

## Introducción

![Una foto de un bloc de notas y un bolígrafo. El bloc dice "Budget" en la parte superior, con una lista numerada debajo…](media/Python_09_00_000.jpg)

*crédito: modificación de la obra "Budget and Bills", de Alabama Extension/Flickr, dominio público*

Los programadores suelen trabajar con colecciones de datos. Las listas son una forma útil de reunir elementos de datos. Las listas de Python son extremadamente flexibles y, a diferencia de las cadenas, su contenido se puede cambiar.

El capítulo sobre objetos presentó las listas. Este capítulo explora las operaciones que se pueden realizar con ellas.

<!-- modulo: m00066 -->

## 9.1 Modificación e iteración de listas

### Objetivos de aprendizaje

Al terminar esta sección, deberías poder:

- Modificar una lista con las operaciones de lista `append()`, `remove()` y `pop()`.
- Buscar en una lista con un bucle `for`.

### Uso de operaciones de lista para modificar una lista

Una operación `append()` se usa para agregar un elemento al final de una lista. En programación, **append** significa agregar al final. Una operación `remove()` elimina el elemento especificado de una lista. Una operación `pop()` elimina el último elemento de una lista.

**Ejemplo: Operaciones sencillas para modificar una lista**

El siguiente código muestra operaciones sencillas para modificar una lista.

La línea 8 muestra la operación `append()`, la línea 12 muestra la operación `remove()` y la línea 17 muestra la operación `pop()`. Como la operación `pop()` elimina el último elemento, no se necesita ningún parámetro.

```python
"""Operaciones para agregar y eliminar elementos de una lista."""

# Crear una lista de estudiantes que trabajan en un proyecto
student_list = ["Jamie", "Vicky", "DeShawn", "Tae"]
print(student_list)

# Otro estudiante se une al proyecto. Hay que agregarlo a la lista.
student_list.append("Ming")
print(student_list)

# "Jamie" abandona el proyecto. Hay que eliminar a Jamie de la lista.
student_list.remove("Jamie")
print(student_list)

# Supongamos que hubiera que eliminar a "Ming" de la lista.
# Se puede usar una operación pop() porque Ming es el último de la lista.
student_list.pop()
print(student_list)
```

La salida del código anterior es:

```salida
['Jamie', 'Vicky', 'DeShawn', 'Tae']
['Jamie', 'Vicky', 'DeShawn', 'Tae', 'Ming']
['Vicky', 'DeShawn', 'Tae', 'Ming']
['Vicky', 'DeShawn', 'Tae']
```

**Conceptos en práctica: Modificación de listas**

<!-- pregunta: CPL-ch09-m01-p01 -->

1. ¿Qué operación se puede usar para agregar un elemento al final de una lista?

   - a) `add()`
   - b) `append()`
   - c) `pop()`

   <details><summary>Respuesta</summary>

   b) La operación `append()` agrega un elemento al final de una lista.

   </details>

<!-- pregunta: CPL-ch09-m01-p02 -->

2. ¿Cuál es la sintaxis correcta para eliminar el elemento `23` de una lista llamada `number_list`?

   - a) `remove()`
   - b) `number_list.remove()`
   - c) `number_list.remove(23)`

   <details><summary>Respuesta</summary>

   c) El elemento que se va a eliminar se pasa como parámetro a la operación remove. El remove se aplica a la lista especificada.

   </details>

<!-- pregunta: CPL-ch09-m01-p03 -->

3. ¿Qué operación se puede usar para eliminar un elemento del final de una lista?

   - a) solo `pop()`
   - b) solo `remove()`
   - c) `pop()` o `remove()`

   <details><summary>Respuesta</summary>

   c) Tanto `pop()` como `remove()` se pueden usar para eliminar el último elemento de una lista. `pop()` elimina automáticamente el último elemento, mientras que `remove()` requiere que se especifique el último elemento.

   </details>

### Iteración de listas

Se puede usar un bucle for iterativo para recorrer una lista. Como alternativa, las listas se pueden recorrer usando los índices de la lista con un bucle for de conteo. La animación siguiente muestra ambas formas de iterar una lista.

**Video:** [Using len() to get the length of a list](https://www.openstax.org/r/len-function)

**Conceptos en práctica: Iteración de listas**

<!-- pregunta: CPL-ch09-m01-p04 -->

1. ¿Cuántas veces se ejecutará el siguiente bucle `for`?
    `for element in my_list: `

   - a) 5
   - b) 4

   <details><summary>Respuesta</summary>

   a) La longitud de la lista es 5, por lo que el bucle `for` iterativo se ejecuta cinco veces.

   </details>

<!-- pregunta: CPL-ch09-m01-p05 -->

2. ¿Cuál es el valor final de `i` en el siguiente bucle `for` de conteo?
    `for i in range(0, len(my_list)):`

   - a) `9`
   - b) `4`
   - c) `5`

   <details><summary>Respuesta</summary>

   b) `len(my_list)` es 5. Un bucle `for` de conteo termina en 1 menos que el segundo valor de la función range, por lo que el valor final de `i` es `4`.

   </details>

<!-- pregunta: CPL-ch09-m01-p06 -->

3. ¿Cuál es la salida del siguiente código?
   
   ```python norun
   for i in range(0, len(my_list), 2):
     print(my_list[i], end=' ')
   ```

   - a) `2 5 9`
   - b) `2 3 5 7 9`
   - c) `2`
      `5`
      `9`

   <details><summary>Respuesta</summary>

   a) El bucle `for` avanza de dos en dos, por lo que se imprimen los índices 0, 2 y 4. Debido a `"end="` en la instrucción print, todos los elementos se imprimen en una sola línea.

   </details>

**Pruébalo: Lista de deportes**

Crea una lista de deportes que se practican en un campus universitario. Los deportes que se incluirán son béisbol, fútbol americano, tenis y tenis de mesa.

A continuación, agrega voleibol a la lista.

Luego, elimina `"football"` de la lista y agrega `"soccer"` a la lista.

Muestra el contenido de la lista después de cada modificación.

<!-- coderunner: ch9/CodeRunner_09_02_01_Sports-list -->

**Pruébalo: Búsqueda simple**

Escribe un programa que imprima `"found!"` si `"soccer"` se encuentra en la lista dada.

<!-- coderunner: ch9/CodeRunner_09_02_02_Simple-Searching -->

<!-- modulo: m00068 -->

## 9.2 Ordenamiento e inversión de listas

### Objetivos de aprendizaje

Al terminar esta sección, deberías poder:

- Comprender el concepto de ordenamiento.
- Usar los métodos integrados `sort()` y `reverse()`.

### Ordenamiento

Ordenar los elementos de una secuencia suele ser útil. El **ordenamiento** es la tarea de organizar los elementos de una secuencia en orden ascendente o descendente.

El ordenamiento puede aplicarse a datos numéricos o no numéricos. Al ordenar texto, se usa el orden del diccionario. Ej.: "bat" va antes que "cat" porque "b" va antes que "c".

**Video:** [Sorting](https://www.openstax.org/r/sorting)

**Conceptos en práctica: Ordenamiento**

<!-- pregunta: CPL-ch09-m03-p01 -->

1. ¿Cuál sería el último elemento de la siguiente lista si se ordena de forma descendente?
    `[12, 3, 19, 25, 16, -3, 5]`

   - a) `25`
   - b) `-3`
   - c) `5`

   <details><summary>Respuesta</summary>

   b) Ordenar de forma descendente significa organizar los elementos de mayor a menor. -3 es el elemento más pequeño de la lista y sería el último cuando la lista se ordena de forma descendente.

   </details>

<!-- pregunta: CPL-ch09-m03-p02 -->

2. Organiza la siguiente lista en orden ascendente.
    `["cat", "bat", "dog", "coyote", "wolf"]`

   - a) `["bat", "cat", "coyote", "dog", "wolf"]`
   - b) `["wolf", "coyote", "dog", "cat", "bat"]`

   <details><summary>Respuesta</summary>

   a) Para las cadenas, el orden ascendente se refiere al orden del diccionario.

   </details>

<!-- pregunta: CPL-ch09-m03-p03 -->

3. ¿Cómo se relacionan las palabras `"flask"` y `"flash"` en Python?

   - a) `"flask" < "flash"`
   - b) `"flask" == "flash"`
   - c) `"flask" > "flash"`

   <details><summary>Respuesta</summary>

   c) En orden alfabético, "h" va antes que "k". Los primeros cuatro caracteres son iguales, por lo que `"flash"` va antes que `"flask"`.

   </details>

### Uso de `sort()` y `reverse()`

Python proporciona métodos para organizar los elementos de una lista.

- El método `sort()` organiza los elementos de una lista en orden ascendente. Para las cadenas se usan los valores ASCII y los caracteres en mayúscula van antes que los de minúscula, lo que lleva a resultados inesperados. Ej.: `"A"` se ordena antes que `"a"` en orden ascendente, pero también `"G"`; por lo tanto, `"Gail"` va antes que `"apple"`.
- El método `reverse()` invierte los elementos de una lista.

**Ejemplo: Ordenamiento e inversión de listas**

```python
# Configurar una lista de números
num_list = [38, 92, 23, 16]
print(num_list)

# Ordenar la lista
num_list.sort()
print(num_list)

# Configurar una lista de palabras
dance_list = ["Stepping", "Ballet", "Salsa", "Kathak", "Hopak", "Flamenco", "Dabke"]

# Invertir la lista
dance_list.reverse()
print(dance_list)

# Ordenar la lista
dance_list.sort()
print(dance_list)
```

La salida del código anterior es:

```text
[38, 92, 23, 16]
[16, 23, 38, 92]
["Dabke", "Flamenco", "Hopak", "Kathak", "Salsa", "Ballet", "Stepping"]
["Ballet", "Dabke", "Flamenco", "Hopak", "Kathak", "Salsa", "Stepping"]
```

**Conceptos en práctica: Métodos sort() y reverse()**

<!-- pregunta: CPL-ch09-m03-p04 -->

1. ¿Cuál es la forma correcta de ordenar la lista `board_games` en orden ascendente?

   - a) `sort(board_games)`
   - b) `board_games.sort()`
   - c) `board_games.sort('ascending')`

   <details><summary>Respuesta</summary>

   b) El método `sort()` debe aplicarse a la lista. El valor predeterminado de la función `sort()` es organizar los elementos en orden ascendente.

   </details>

<!-- pregunta: CPL-ch09-m03-p05 -->

2. ¿Cuál es la forma correcta de invertir la lista `board_games`?

   - a) `board_games.reverse()`
   - b) `reverse(board_games)`

   <details><summary>Respuesta</summary>

   a) La sintaxis correcta de la función `reverse()` requiere que la función se aplique a la lista.

   </details>

<!-- pregunta: CPL-ch09-m03-p06 -->

3. ¿Cuál sería el último elemento de `board_games` después de aplicar el método `reverse()`?

   - a) `'go'`
   - b) `'checkers'`
   - c) `'scrabble'`

   <details><summary>Respuesta</summary>

   a) `"go"` es el primer elemento de `board_games`, por lo que `"go"` sería el último elemento una vez invertida `board_games`.

   </details>

**Pruébalo: Ordenamiento e inversión**

Completa el siguiente programa para organizar e imprimir los números en orden ascendente y descendente.

<!-- coderunner: ch9/CodeRunner_09_03_04_Sorting-and-reversing -->

<!-- modulo: m00069 -->

## 9.3 Operaciones comunes con listas

### Objetivos de aprendizaje

Al terminar esta sección, deberías poder:

- Usar las funciones integradas `max()`, `min()` y `sum()`.
- Demostrar cómo copiar una lista.

### Uso de operaciones integradas

La función `max()` aplicada a una lista devuelve el elemento más grande de la lista. La función `min()` aplicada a una lista devuelve el elemento más pequeño de la lista. Las funciones `max()` y `min()` funcionan con listas siempre que los elementos de la lista sean comparables.

La función `sum()` aplicada a una lista de números devuelve la suma de todos los elementos de la lista.

**Ejemplo: Operaciones comunes con listas**

```python norun
"""Operaciones comunes con listas."""

# Configurar una lista de números
snum_list = [28, 92, 17, 3, -5, 999, 1]

# Configurar una lista de palabras
city_list = ["New York", "Missoula", "Chicago", "Bozeman",
"Birmingham", "Austin", "Sacramento"]

# Uso de la función max()
print(max(num_list))

# La función max() también funciona con cadenas
print(max(city_list))

# Uso de la función min(), que también funciona con cadenas
print(min(num_list))

print(min(city_list))

# sum() solo funciona con una lista de números
print(sum(num_list))
```

La salida del código anterior es:

```text
999
Sacramento
-5
Austin
1135
```

**Conceptos en práctica: Operaciones con listas**

<!-- pregunta: CPL-ch09-m04-p01 -->

1. ¿Cuál es la forma correcta de obtener el mínimo de una lista llamada `nums_list`?

   - a) `min(nums_list)`
   - b) `nums_list.min()`
   - c) `minimum(nums_list)`

   <details><summary>Respuesta</summary>

   a) La función `min()` toma una lista como parámetro y devuelve el mínimo de la lista.

   </details>

<!-- pregunta: CPL-ch09-m04-p02 -->

2. ¿Cuál es el mínimo de la siguiente lista?
    `["Lollapalooza", "Coachella", "Newport Jazz festival", "Hardly Strictly Bluegrass", "Austin City Limits"]`

   - a) `Coachella`
   - b) `Austin City Limits`
   - c) El mínimo no existe.

   <details><summary>Respuesta</summary>

   b) `"Austin City Limits"` es la primera cadena en el orden del diccionario.

   </details>

<!-- pregunta: CPL-ch09-m04-p03 -->

3. ¿Qué valor devuelve la llamada a función?
    `sum([1.2, 2.1, 3.2, 5.9])`

   - a) `sum()` solo funciona con enteros.
   - b) `11`
   - c) `12.4`

   <details><summary>Respuesta</summary>

   c) La suma de los floats dados es `12.4`.

   </details>

### Copia de una lista

El método `copy()` se usa para crear una copia de una lista.

**Video:** [Copying a list](https://www.openstax.org/r/copying-list)

**Conceptos en práctica: Copia de una lista**

<!-- pregunta: CPL-ch09-m04-p04 -->

1. ¿Cuál es la salida del siguiente código?
   
   ```python
   my_list = [1, 2, 3]
   list2 = my_list
   list2[0] = 13
   print(sum(my_list))
   ```

   - a) `6`
   - b) `13`
   - c) `18`

   <details><summary>Respuesta</summary>

   c) `list2` se refiere a la misma lista que `my_list`, por lo que cualquier cambio hecho en `list2` también se refleja en `my_list`. 18 es la suma de los valores de la lista.

   </details>

<!-- pregunta: CPL-ch09-m04-p05 -->

2. ¿Cuál es la salida del siguiente código?
   
   ```python
   my_list = [1, 2, 3]
   list2 = my_list.copy()
   list2[0] = 13
   print(max(my_list))
   ```

   - a) `3`
   - b) `13`
   - c) `18`

   <details><summary>Respuesta</summary>

   a) 3 es el valor máximo de la lista `my_list`. La línea 3 cambia el valor del primer elemento de `list2`.

   </details>

<!-- pregunta: CPL-ch09-m04-p06 -->

3. ¿Cuál es la salida del siguiente código?
   
   ```python norun
   my_list = ["Cat", "Dog", "Hamster"]
   list2 = my_list
   list2[2] = "Pigeon"
   print(sum(my_list))
   ```

   - a) `CatDogPigeon`
   - b) `Error`

   <details><summary>Respuesta</summary>

   b) La función `sum()` no está definida para valores de tipo cadena.

   </details>

**Pruébalo: Copia**

Haz una copia de `word_list` llamada wisdom. Ordena la lista llamada wisdom. Crea una oración con las palabras de cada lista e imprime esas oraciones (no hace falta agregar puntos al final de las oraciones).

<!-- coderunner: ch9/CodeRunner_09_04_05_Copy -->

<!-- modulo: m00070 -->

## 9.4 Listas anidadas

### Objetivos de aprendizaje

Al terminar esta sección, deberías poder:

- Demostrar el uso de una lista de listas para estructurar datos.
- Demostrar el direccionamiento de elementos individuales mediante indexación multidimensional.
- Usar bucles anidados para recorrer una lista de listas.

### Lista de listas

Las listas pueden estar formadas por elementos de cualquier tipo. Un elemento de una lista también puede ser una lista. Ej.: `[2, [3, 5], 17]` es una lista válida, en la que la lista `[3, 5]` es el elemento en el índice 1.

Cuando una lista es un elemento dentro de una lista más grande, se llama **lista anidada**. Las listas anidadas son útiles para expresar datos multidimensionales. Cuando cada uno de los elementos de una lista más grande es una lista más pequeña, la lista más grande se llama **lista de listas**.

Ej.: Una tabla se puede almacenar como una lista de listas bidimensional, donde cada fila de datos es una lista dentro de la lista de listas.

**Video:** [List-of-lists](https://www.openstax.org/r/list-of-lists)

**Conceptos en práctica: Listas**

<!-- pregunta: CPL-ch09-m05-p01 -->

1. ¿Cuál sería la forma correcta de representar `matA` en Python?

   - a)

     ```python
     [[7, 4, 5], [3, 9, 6], [1, 2, 8]]
     ```

   - b)

     ```python norun
     [7, 4, 5
     3, 9, 6
     1, 2, 8]
     ```

   - c)

     ```python norun
     [[7, 3, 1], [4, 9, 2], [1, 2, 8]
     ```

   <details><summary>Respuesta</summary>

   a) Cada fila de la matriz se representa como una lista dentro de la lista de listas más grande, `matA`. `matA` representa la matriz completa.

   </details>

<!-- pregunta: CPL-ch09-m05-p02 -->

2. ¿Cuál sería el índice correcto para el número `6` en la lista anterior?

   - a) `[5]`
   - b) `[2][1]`
   - c) `[1][2]`

   <details><summary>Respuesta</summary>

   c) 6 está en la 2.ª fila y la 3.ª columna. Con indexación desde cero, resulta el índice 1 para la fila y 2 para la columna.

   </details>

<!-- pregunta: CPL-ch09-m05-p03 -->

3. ¿Cuál sería el resultado del siguiente código?
   
   ```python norun
   print(matA[0])
   ```

   - a) `Error`
   - b) `7`
   - c) `[7, 4, 5]`

   <details><summary>Respuesta</summary>

   c) El primer elemento de la lista `matA` es una lista `[7, 4, 5]` que representa la primera fila de la matriz.

   </details>

### Uso de bucles anidados para recorrer listas anidadas

Se puede usar una estructura de bucles anidados para recorrer una lista de listas. En una lista de listas bidimensional, se puede usar un bucle `for` externo para las filas y un bucle `for` interno para las columnas.

**Ejemplo: Iteración de una lista de listas**

El siguiente código muestra cómo recorrer una lista de listas.

El bucle externo de la línea 9 recorre elemento por elemento la lista más grande. Cada elemento de la lista más grande es una lista. El bucle interno de la línea 10 recorre cada elemento de cada lista anidada.

```python
"""Iteración de una lista de listas."""

# Crear una lista de números
list1 = [[1, 2, 3],
        [1, 4, 9],
        [1, 8, 27]]

# Iterar la lista de listas
for row in list1:
  for num in row:
    print(num, end=" ")
  print()
```

La salida del código anterior es:

```salida
1 2 3
1 4 9
1 8 27
```

**Conceptos en práctica: Iteración de una lista de listas**

<!-- pregunta: CPL-ch09-m05-p04 -->

1. ¿Qué código imprime cada número de `my_list`, empezando por `7`, luego `4` y así sucesivamente hasta terminar en `-5`?

   - a)

     ```python norun
     for row in my_list:
       for elem in row:
         print(elem)
     ```

   - b)

     ```python norun
     for elem in my_list:
         print(elem)
     ```

   <details><summary>Respuesta</summary>

   a) El bucle `for` externo recorre fila por fila. El bucle `for` interno recorre cada elemento de una fila. Así se imprimen todos los números, desde el 7 hasta el -5.

   </details>

<!-- pregunta: CPL-ch09-m05-p05 -->

2. La función `range()` también se puede usar para recorrer una lista de listas. ¿Qué código imprime cada número de `my_list`, empezando por `7`, luego `4` y así sucesivamente, hasta terminar en `-5`, usando bucles `for` de conteo?

   - a)

     ```python norun
     for column_index in range(0, len(my_list[0])):
       for row_index in range (0, len(my_list)):
         print(my_list[row_index][column_index])
     ```

   - b)

     ```python norun
     for row_index in range(0, len(my_list)):
       for column_index in range (0, len(my_list)):
         print(my_list[row_index][column_index])
       print()
     ```

   - c)

     ```python norun
     for row_index in range(0, len(my_list)):
       for column_index in range (0, len(my_list[0])):
         print(my_list[row_index][column_index])
     ```

   <details><summary>Respuesta</summary>

   c) El bucle `for` externo se ejecuta tres iteraciones porque hay tres elementos en la lista de listas. El bucle `for` interno recorre cada elemento de cada fila usando la longitud de cada fila.

   </details>

**Pruébalo: Multiplicación de matrices**

Escribe un programa que calcule el producto de la multiplicación de matrices de las matrices matW y matZ que se muestran a continuación, y que imprima el resultado. Se muestra el resultado esperado.

mat W = [13 4 5; 2 -9 7; 7 3 19]mat Z = [2 1 5; 3 7 9; -1 13 19]

result = [33 106 196; -30 30 62; 4 275 423]

En la matriz de resultado, cada elemento se calcula según la posición del elemento. El resultado en la posición `[i][j]` se calcula usando la fila `i` de la primera matriz, W, y la columna `j` de la segunda matriz, Z.

Ej.:

`result[1][2]` = (fila 1 de W) por (columna 2 de Z)

result[1][2] = [2 -9 7] * [5; 9; 19]

result[1][2] = 2*5 + (-9)*9 + 7*19 = 10-81 + 133 = 62

<!-- coderunner: ch9/CodeRunner_09_05_06_Matrix-multiplication -->

<!-- modulo: m00071 -->

## 9.5 Comprensiones de listas

### Objetivos de aprendizaje

Al terminar esta sección, deberías poder:

- Identificar los diferentes componentes de una instrucción de comprensión de listas.
- Implementar el filtrado mediante comprensión de listas.

### Comprensiones de listas

Una **comprensión de listas** es una instrucción de Python para crear de forma compacta una nueva lista a partir de un patrón.

La forma general de una instrucción de comprensión de listas se muestra a continuación.

`list_name = [expression for loop_variable in iterable]`

`list_name` se refiere al nombre de una lista nueva, que puede ser cualquiera, y `for` es la palabra clave del bucle `for`. Una expresión define qué pasará a formar parte de la nueva lista. `loop_variable` es un iterador e `iterable` es un objeto que se puede recorrer, como una lista o una cadena.

**Ejemplo: Creación de una lista nueva con una comprensión de listas**

La comprensión de listas que se muestra abajo, en el segundo código, tiene el mismo efecto que el bucle `for` normal del primer código. La lista resultante es `[0, 1, 4, 9, 16, 25, 36, 49, 64, 81]` en ambos casos.

Creación de una lista de cuadrados con un bucle `for`.

```python
# Crear una lista vacía.
squares_list = []

# Agregar elementos a una lista, como cuadrados de números desde 0 hasta 9.
for i in range(10):
  squares_list.append(i*i)
```

Creación de una lista de cuadrados con la comprensión de listas.

```python
square_list = [i*i for i in range(10)]
```

La expresión `i*i` se aplica a cada valor de `loop_variable`, que aquí es `i`.

**Ejemplo: Un poema del Dr. Seuss**

Se puede usar una comprensión de listas para crear una lista a partir de otra lista. En la línea 6, el bucle `for` se escribe sobre la lista `poem_lines`.

```python
# Crear una lista de palabras
words_list = ["one", "two", "red", "blue"]

# Usar una comprensión de listas para crear una nueva lista llamada poem_lines
# Insertando la palabra "fish" unida a cada palabra de words_list
poem_lines = [w + " fish" for w in words_list]
for line in poem_lines:
  print(line)
```

La salida del código anterior es:

```salida
one fish
two fish
red fish
blue fish
```

**Conceptos en práctica: Comprensiones de listas**

<!-- pregunta: CPL-ch09-m06-p01 -->

1. El componente de una comprensión de listas que define un elemento de la nueva lista es la _____.

   - a) expresión
   - b) loop_variable
   - c) contenedor

   <details><summary>Respuesta</summary>

   a) La expresión le indica a Python qué elemento poner en la nueva lista.

   </details>

<!-- pregunta: CPL-ch09-m06-p02 -->

2. ¿Cuál sería el contenido de `b_list` después de ejecutar el siguiente código?
   
   ```python
   a_list = [1, 2, 3, 4, 5]
   b_list = [i+2 for i in a_list]
   ```

   - a) `[1, 2, 3, 4, 5]`
   - b) `[0, 1, 2, 3, 4]`
   - c) `[3, 4, 5, 6, 7]`

   <details><summary>Respuesta</summary>

   c) `i+2` suma 2 a cada elemento de `a_list` para generar `b_list`.

   </details>

<!-- pregunta: CPL-ch09-m06-p03 -->

3. ¿Qué contiene `new_list` después de ejecutar la siguiente instrucción?
   
   ```python
   new_list = [i//3 for i in range(1, 15, 3)]
   ```

   - a) `[0.3333333333333333, 1.3333333333333333, 2.3333333333333335, 3.3333333333333335, 4.333333333333333]`
   - b) `[0, 1, 2, 3, 4]`
   - c) `[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]`

   <details><summary>Respuesta</summary>

   b) El bucle `for` empieza en 1 y avanza de tres en tres, por lo que comienza en 1 y termina en 13. Dividir con el operador `//` descarta la parte decimal.

   </details>

### Filtrado con comprensiones de listas

Las comprensiones de listas se pueden usar para filtrar elementos de una lista dada. Se agrega una *condición* a la comprensión de listas.

`list_name = [expression for loop_variable in container if condition]`

En una comprensión de listas con filtro, un elemento se agrega a `list_name` solo si se cumple la condición.

**Video:** [Filtering a list](https://www.openstax.org/r/filtering-list)

**Conceptos en práctica: Filtrado con comprensiones de listas**

<!-- pregunta: CPL-ch09-m06-p04 -->

1.

   ```python
   my_list = [21, -1, 50, -9, 300, -50, 2]
   
   new_list = [m for m in my_list if m < 0]
   ```

   - a) `[21, 50, 300, 2]`
   - b) `[21, -1, 50, -9, 300, -50, 2]`
   - c) `[-1, -9, -50]`

   <details><summary>Respuesta</summary>

   c) La comprensión de listas filtra los números negativos de `my_list`.

   </details>

<!-- pregunta: CPL-ch09-m06-p05 -->

2.

   ```python
   my_string = "This is a home."
   
   new_list = [i for i in my_string if i in 'aeiou']
   ```

   - a) `[i, i, a, o, e]`
   - b) `['i', 'i'', 'a', 'o', 'e']`
   - c) `Error`

   <details><summary>Respuesta</summary>

   b) La comprensión de listas selecciona las vocales de la cadena dada.

   </details>

<!-- pregunta: CPL-ch09-m06-p06 -->

3.

   ```python
   new_list = [r for r in range (0, 21, 2) if r%2 != 0]
   ```

   - a) `[]`
   - b) `[21]`
   - c) `[1, 3, 5, 7, 9, 11, 13, 15, 17, 19]`

   <details><summary>Respuesta</summary>

   a) El bucle `for` recorre desde 0 hasta 20, de dos en dos, pero cada elemento iterado es par, por lo que no se agrega nada a `new_list`.

   </details>

**Pruébalo: Selección de palabras de cinco letras**

Escribe un programa que cree una lista solo con las palabras de cinco letras de la lista dada e imprima la nueva lista.

<!-- coderunner: ch9/CodeRunner_09_06_07_Selecting-5-letter-words -->

**Pruébalo: Libros que empiezan con "A"**

Escribe un programa que seleccione las palabras que comienzan con "A" en la lista dada. Asegúrate de que la nueva lista se ordene después en orden de diccionario. Por último, imprime la nueva lista ordenada.

<!-- coderunner: ch9/CodeRunner_09_06_08_Books-starting-with-_A_ -->

<!-- modulo: m00072 -->

## Resumen del capítulo

Los puntos principales de este capítulo son:

- Las listas son mutables y se pueden modificar fácilmente con las operaciones `append()`, `remove()` y `pop()`.
- Las listas son iterables y se pueden recorrer con un iterador o con los índices de los elementos.
- La operación `sort()` organiza los elementos de una lista en orden ascendente si todos los elementos de la lista son del mismo tipo.
- La operación `reverse()` invierte una lista.
- El método `copy()` se usa para crear una copia de una lista.
- Las listas tienen funciones integradas para encontrar el máximo, el mínimo y la suma de una lista, cuando esta contiene solo valores numéricos.
- Las listas se pueden anidar para representar datos multidimensionales.
- Una comprensión de listas es una forma compacta de crear una lista nueva, y se puede usar para filtrar elementos de una lista existente.

En este punto, deberías poder escribir programas que usen listas.

**Referencia del capítulo 9.**

| Función | Descripción |
|---|---|
| `append(element)` | Agrega el elemento especificado al final de una lista. |
| `remove(element)` | Elimina el elemento especificado de la lista si el elemento existe. |
| `pop()` | Elimina el último elemento de una lista. |
| `max(list)` | Devuelve el elemento máximo de la lista especificada. |
| `min(list)` | Devuelve el elemento máximo de la lista especificada. |
| `sum(list)` | Devuelve la suma de una lista compuesta por números. |
| `sort()` | Ordena en orden ascendente la lista sobre la que se llama al método. |
| `reverse()` | Invierte el orden de los elementos de una lista. |
| `copy()` | Hace una copia completa de una lista. |
