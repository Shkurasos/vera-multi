'use strict';
// Кнопка «Повторить»: адрес сервера приходит из main-процесса в ?server=.
// Принимаем только http(s), чтобы в query нельзя было подсунуть javascript: и т.п.
(function () {
  var raw = new URLSearchParams(location.search).get('server') || '';
  var server = /^https?:\/\/[^\s]+$/i.test(raw) ? raw : '';
  var button = document.getElementById('retry');
  var status = document.getElementById('status');
  var addr = document.getElementById('addr');
  if (server && addr) addr.textContent = server;
  function retry() {
    if (!server) { status.textContent = 'Адрес сервера не задан.'; return; }
    status.textContent = 'Подключаемся…';
    button.disabled = true;
    location.href = server;
  }
  button.addEventListener('click', retry);
  // Сеть вернулась — пробуем сами.
  window.addEventListener('online', retry);
})();
