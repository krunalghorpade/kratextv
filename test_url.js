const url = "https://www.youtube.com/watch?v=VIDEO_ID&list=PL9ExUjv_4xfHyE70ZC4BDxRR-X1upUjbh&index=5";
const match = url.match(/[?&]list=([^#\&\?]+)/);
console.log(match ? match[1] : null);
