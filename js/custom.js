/*
  * @package 
  * @subpackage template name HTML
  * 
  * Template Scripts
  * Created by themeturn
  
  1. Fixed header
  2. Site search
  3. Main slideshow
  4. Owl Carousel
      a. Testimonial
      b. Clients
      c. Team
  5. Back to top
  6. Skills
  7. BX slider
      a. Blog Slider
      b. Portfolio item slider
  8. Isotope
  9. Animation (wow)
  10. Flickr
  
*/


jQuery(function($) {
  "use strict";

   function centerPrettyPhotoPopup() {
      var $holder = $(".pp_pic_holder:visible");
      if (!$holder.length) return;

      var viewportH = $(window).height();
      var scrollTop = $(window).scrollTop();
      var holderH = $holder.outerHeight();
      var top = scrollTop + Math.max(20, (viewportH - holderH) / 2);

      $holder.css("top", top + "px");
   }

   $('.navigation').singlePageNav({
        currentClass: 'active',
        changeHash: true,
        scrollSpeed: 750,
        offset: 0,
        filter: ':not(.external)',
        easing: 'swing',

    });

    $.noConflict();
     $('.nav a').on('click', function(){ 
        if($('.navbar-toggle').css('display') !='none'){
            $(".navbar-toggle").trigger( "click" );
        }
    });


 
// prettyphoto
 $("a[data-rel^='prettyPhoto']").prettyPhoto({
    social_tools: false,
    deeplinking: false,
    show_title: false,
    overlay_gallery: false,
    allow_resize: true,
    fit_to_viewport: true,
    default_width: 1080,
    default_height: 640,
    changepicturecallback: function () {
      setTimeout(function () {
        centerPrettyPhotoPopup();
      }, 0);
    }
 });

  $(window).on("resize", function () {
    centerPrettyPhotoPopup();
  });
 
    
 



});