
// Billing toggle
var billing = 'month';
function setBilling(type) {
  billing = type;
  document.getElementById('tog-month').classList.toggle('active', type === 'month');
  document.getElementById('tog-year').classList.toggle('active', type === 'year');
  if (type === 'year') {
    document.getElementById('pro-price').textContent = '¥23';
    document.getElementById('pro-note').textContent = '按年付 ¥276 / 年';
  } else {
    document.getElementById('pro-price').textContent = '¥29';
    document.getElementById('pro-note').textContent = '按月付款';
  }
}

// FAQ accordion
function toggleFaq(el) {
  var item = el.parentElement;
  item.classList.toggle('open');
}
