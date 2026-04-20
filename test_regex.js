r1 = "https://www.youtube.com/watch?v=abc&list=PLXYZ&index=1".match(/[?&]list=([^&]+)/);
r2 = "https://www.youtube.com/watch?v=abc".match(/[?&]list=([^&]+)/);
console.log(r1 ? r1[1] : 'null');
console.log(r2 ? r2[1] : 'null');
