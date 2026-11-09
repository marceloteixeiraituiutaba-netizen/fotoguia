// Declara a variável global que o TensorFlow.js tenta definir ao carregar.
// Sem isso, ele cai num `Function(...)` que a política de segurança (CSP) do app bloqueia.
window.regeneratorRuntime = undefined;
