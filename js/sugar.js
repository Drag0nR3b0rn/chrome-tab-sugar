/**
 * Copyright (c) 2010 Arnaud Leymet
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 * Chrome Tab Sugar <http://github.com/arnaud/chrome-tab-sugar>
 */

// disable console debugs when the developer mode is off
if(localStorage.debug != "true") {
  console.debug = function() {}
}

track('Sugar', 'Start', 'The dashboard starts');

// keep a reference of the background page
var back = chrome.extension.getBackgroundPage();

// needed for storage.js to work with sugar.js
function updateUI() {
  console.debug("updateUI", back.icebox, back.groups);
  back.updateUI(true);
  setTimeout(updateSugarUI, 200);
}

function updateSugarUI() {
  $(function() {
    // update the icebox
    var ice = back.icebox;
    $('#icebox').width(ice.width).height(ice.height).css('position', 'absolute').css('top', ice.posY+'px').css('left', ice.posX+'px').show();
    for(var t in ice.tabs) {
      var tab = ice.tabs[t];
      $('#icebox>ul').append( tab.ui_create() );
    }
    $('#icebox').autoFitTabs();

    // update the groups
    var groups = back.groups;
    for(var g in groups) {
      var group = groups[g];
      var group_ui = group.ui_create();
      $('#dashboard').append( group_ui );
      group_ui = $('#group-'+group.id);
      for(var t in group.tabs) {
        var tab = group.tabs[t];
        group_ui.addTab( tab.ui_create() );
      }
      group_ui.autoFitTabs();
    }
  });
}


$(function() {

  // disable right-click contextual menu
  $.disableContextMenu();

  // tabs are draggable inside the dashboard
  $('.tab').live("mouseover", function(e) {
    console.debug('Event', 'tab mouseover', e);
    $('.tab').draggable({
      cursor: 'move',
      containment: '#dashboard',
      revert: 'valid',
      cancel: 'a.ui-icon',
      start: function(ev, ui) {
        track('Sugar', 'Drag a tab');
        //TODO $(this).effect('size', {to: {width: 100, height: 80}});
      }
    })
    .sortable();
  });

  // tabs are closeable
  $('.tab .close').live("click", function(e) {
    console.debug('Event', 'tab close click', e);
    track('Sugar', 'Close a tab');

    var tab = $(this).parent().parent();
    var group = tab.group();

    // visually
    tab.fadeOut(function() {
      $(this).remove();
    });

    // in the db
    var group_id = group.uid();
    if(group_id=="icebox") group_id = 0;
    var index = JSON.parse(tab.attr('obj')).index;
    var t = new SugarTab({group_id: group_id, index: index});
    t.db_delete({
      success: function(rs) {}
    });

    // when grabbing the last tab of a group, the initial group should disappear if empty
    var old_group = $(tab).group();
    var nb_tabs_in_old_group = old_group.tabs().not(tab).length;
    if(nb_tabs_in_old_group == 0) {
      // visually
      group.fadeOut(function() {
        $(this).remove();
      });
      // in the db
      var id = group.uid();
      var group = new SugarGroup({id: id});
      group.db_delete({
        success: function(rs) {}
      });

    // if the source group still has tabs, let's resize'em all
    } else {
      old_group.autoFitTabs();
    }

    // prevent the tab clicking event to activate
    return false;
  });

  // tabs are clickable
  $('.tab').live("click", function(e) {
    console.debug('Event', 'tab click', e);
    var group = $(this).group();
    track('Sugar', 'Click a tab', '', group.tabs().length);
    var selected_tab = $(this);
    var url = selected_tab.find('.url').html();
    // open a new window
    chrome.windows.create({ url: url }, function(window) {
      // with all its tabs
      group.tabs().each(function(index) {
        // don't open the current tab (already opened with the window)
        if($(this).get(0) != selected_tab.get(0)) {
          var url = $(this).find('.url').html();
          chrome.tabs.create({ windowId: window.id, index: index, url: url, selected: false });
        }
        //alert(index+" "+url);
      });
    });
  });

  if(localStorage.feature_snapgroups=="true") {
    $('#icebox')
      .append($('<div class="snapper main"></div>'))
      .append($('<div class="snapper top"></div>'))
      .append($('<div class="snapper left"></div>'))
      .append($('<div class="snapper right"></div>'))
      .append($('<div class="snapper bottom"></div>'));
  }

  // groups are draggable, droppable and resizable
  $('.group').live("mouseover", function(e) {
    console.debug('Event', 'group mouseover');

    // groups are draggable inside the dashboard
    $('.group, .snapper').draggable({
      cursor: 'move',
      containment: '#dashboard',
      snap: true,
      snapMode: 'outer',
      snapTolerance: 10,
      start: function(ev, ui) {
        track('Sugar', 'Drag a group', '', $(this).tabs().length);
      },
      stop: function(ev, ui) {
        var id = $(this).uid();
        if(id=="icebox") id = 0;
        var x = $(this).position().left;
        var y = $(this).position().top;
        var group = new SugarGroup({id: id});
        group.db_update({
          key: 'posX',
          val: x,
          success: function(rs) {
            group.db_update({
              key: 'posY',
              val: y,
              success: function(rs) {}
            });
          }
        });
      }
    });

    // groups accept tabs
    $('.group').droppable({
      accept: '.tab',
      hoverClass: 'hover',
      greedy: true,
      drop: function(ev, ui) {
        track('Sugar', 'Drop a tab in a group', 'Drop a tab in an existing group', $(this).tabs().length);
        var tab_ui = ui.draggable;
        var old_group_ui = $(tab_ui).group();
        var new_group_ui = $(this);
        var old_group_id = old_group_ui.uid();
        if(old_group_id=="icebox") old_group_id = 0;
        var new_group_id = new_group_ui.uid();
        if(new_group_id=="icebox") new_group_id = 0;
        console.debug(old_group_ui, new_group_ui);
        if(old_group_ui.get(0) == new_group_ui.get(0)) {
          return false;
        }
        // the tab should fade out and appear in a newly created group
        tab_ui.fadeOut(function() {

          // db
          var index = JSON.parse(tab_ui.attr('obj')).index;
          var t = new SugarTab({group_id: old_group_id, index: index});
          t.db_update({
            key: 'group_id',
            val: new_group_id,
            success: function(rs) {
              t.db_update({
                key: 'index',
                val: new_group_ui.tabs().length, // the new index corresponds to the number of tabs already owned by the new group
                success: function(rs) {
                  // visual
                  new_group_ui.addTab(tab_ui);
                  tab_ui.show();
                  new_group_ui.autoFitTabs();

                  // add it to the group list
                  back.updateUI(true);

                  // when grabbing the last tab of a group, the initial group should disappear if empty
                  var nb_tabs_in_old_group = old_group_ui.tabs().not(tab_ui).length;
                  if(nb_tabs_in_old_group == 0) {
                    // visually
                    old_group_ui.fadeOut(function() {
                      $(this).remove();
                    });
                    // in the db
                    var id = old_group_ui.uid();
                    var old_group = new SugarGroup({id: id});
                    old_group.db_delete({
                      success: function(rs) {
                        console.debug('Removal of group was succesful', rs);
                      }
                    });

                  // if the source group still has tabs, let's resize'em all
                  } else {
                    old_group_ui.autoFitTabs();
                  }
                }
              });
            }
          });


          /*old_group_ui.autoFitTabs();
          new_group_ui.addTab(tab_ui);
          // db
          var group_id = old_group_ui.uid();
          var index = JSON.parse(tab_ui.attr('obj')).index;
          if(group_id=="icebox") group_id = 0;
          var tab = new SugarTab({group_id: group_id, index: index});
          group_id = new_group_ui.uid();
          index = new_group_ui.tabs().length;
          tab.db_update({
            key: 'group_id',
            val: group_id,
            success: function(rs) {
              tab.db_update(
                key: 'index',
                val: index,
                success: function(rs) {
                  // visual
                  tab_ui.css('top',0).css('left',0);
                  tab_ui.show();
                  new_group_ui.autoFitTabs();
                }
              });
            }
          });*/
        });
      }
    });

    // dashboard accepts tabs (will create a new group)
    $('html > *').droppable({
      accept: '.tab',
      hoverClass: 'hover',
      greedy: true,
      drop: function(ev, ui) {
        track('Sugar', 'Drop a tab in a new group', 'Drop a tab in a new group');
        var tab_ui = ui.draggable;
        var tab = tab_ui.object();

        var old_group_ui = tab_ui.group();
        var old_group = old_group_ui.object();

        var new_group = new SugarGroup({
          id: SugarGroup.next_index(),
          name: "New group",
          posX: ev.clientX-ev.layerX-17,
          posY: ev.clientY-ev.layerY-36,
          width: 155,
          height: 150
        });
        var new_group_ui = new_group.ui_create();

        // the tab should fade out and appear in a newly created group
        tab_ui.fadeOut(function() {

          // visual
          $('#dashboard').append(new_group_ui);
          new_group_ui.addTab(tab_ui);
          tab_ui.show();
          new_group_ui.autoFitTabs();

          // db
          new_group.db_insert({
            success: function(rs) {
              var t = new SugarTab({group_id: old_group.id, index: tab.index});
              t.db_update({
                key: 'group_id',
                val: new_group.id,
                success: function(rs) {
                  t.db_update({
                    key: 'index',
                    val: new_group_ui.tabs().length, // the new index corresponds to the number of tabs already owned by the new group
                    success: function(rs) {
                      // when grabbing the last tab of a group, the initial group should disappear if empty
                      var nb_tabs_in_old_group = old_group_ui.tabs().not(tab_ui).length;
                      if(nb_tabs_in_old_group == 0) {
                        // visually
                        old_group_ui.fadeOut();
                        // in the db
                        old_group.db_delete({
                          success: function(rs) {}
                        });
                      }

                      // add it to the group list
                      back.updateUI(true);
                    }
                  });
                }
              });
            }
          });

        });

      }
    });

    // groups are resizeable
    $('.group').resizable({
      // inner tabs are resized accordingly
      minHeight: 150, // GROUP_MIN_HEIGHT
      minWidth: 150, // GROUP_MIN_WIDTH
      stop: function(ev, ui) {
        track('Sugar', 'Resize a group', '', $(this).tabs().length);
        var id = $(this).uid();
        if(id=="icebox") id = 0;
        var w = $(this).width();
        var h = $(this).height();
        var group = new SugarGroup({id: id});
        group.db_update({
          key: 'width',
          val: w,
          success: function(rs) {
            group.db_update({
              key: 'height',
              val: h,
              success: function(rs) {}
            });
          }
        });
      },
      resize: function(ev, ui) {
        $(this).autoFitTabs();
      }
    });

    // group titles are editable
    $('.group>.title').not('#icebox>.title').editable(function(value, settings) {
      track('Sugar', 'Rename a group', '', $(this).parent().tabs().length);
      var id = $(this).parent().uid();
      var group = new SugarGroup({id:id});
      group.db_update({
        key: 'name',
        val: value,
        success: function(rs) {}
      });
      if(localStorage.debug=="true") {
        $('.debug', $(this).parent()).html('#'+id+' / '+value);
      }
      return value;
    },
    {
      onblur: 'submit'
    });
  });

  // groups are closeable
  $('.group>.close').live("click", function(e) {
    console.debug('Event', 'group close click', e);
    track('Sugar', 'Close a group', '', $(this).parent().tabs().length);
    var group = $(this).parent();

    // visually
    group.fadeOut(function() {
      $(this).remove();
    });

    // in the db
    var id = $(this).parent().uid();
    var group = new SugarGroup({id: id});
    group.db_delete({
      success: function(rs) {}
    });
  });

  // stacked tabs can be fanned out
  $('.fan_icon').live("click", function(e) {
    console.debug('Event', 'group fan out click', e);
    var group = $(this).parent();
    track('Sugar', 'Fan out tabs', 'Fan out tabs of a group', group.tabs().length);
    group.fanOut();
    group.tabs().find('.close').hide();
  });

  // fanned groups disappear when the mouse isn't hover anymore
  $('.fangroup').live("mouseleave", function(e) {
    console.debug('Event', 'group fan out mouseleave', e);
    var group = $(this).parent();
    track('Sugar', 'Unfan out tabs', 'Unfan out tabs of a group', group.tabs().length);
    group.fanOutHide();
  });

  // handle group creation with the mouse within the dashboard
  $('#dashboard').live("mousedown", function(e) {
    console.debug('Event', 'dashboard/group mousedown', e.currentTarget, e.pageX, e.pageY, e);
    // if there is already a group at this position, stop the event
    if($(this).isGroupAtPosition(e.pageX, e.pageY)) {
      console.debug('Event', 'dashboard/group mousedown', 'aborted: There is already a group at this position');
      return;
    }
    // if not, then go create the group
    var id = SugarGroup.next_index();
    var group = new SugarGroup({id: id});
    var groupUI = group.ui_create();
    groupUI.width(30).height(20).css('position', 'absolute').css('top', (e.pageY-10)+'px').css('left', (e.pageX-10)+'px').css('opacity', 0).find('.title').hide();
    groupUI.mousemove(function(e){
      console.debug('mousemove');
      var w = e.pageX - $(this).position().left + 20;
      var h = e.pageY - $(this).position().top + 10;
      var opacity = (h + w < 200) ? 0.5 : 1;
      $(this).width(w).height(h).css('opacity', opacity);
    });
    groupUI.attr('status', 'new');
    groupUI.mouseup(onGroupMouseUp);
    $(this).append(groupUI);
    return groupUI;
  });

  // get rid of any group mousemove events on mouseup
  $('#dashboard').mouseup(function(e){
    console.debug('Event', 'dashboard mouseup', e.pageX, e.pageY, e);
    $('.group', this).not('#icebox').unbind('mousemove');
  });
});

function onGroupMouseUp() {
  console.debug('onGroupMouseUp', $(this).attr('status'));
  $(this).unbind('mousemove');
  var id = $(this).uid();
  var title = $('.title', this).html();
  var w = $(this).width();
  var h = $(this).height();
  var x = $(this).position().left;
  var y = $(this).position().top;
  //console.debug($(this), w, h);
  // minimal size in order to keep the group displayed
  if(h + w < 200) {
    track('Sugar', 'Create a group', 'Create a group with mousedown', false);
    $(this).fadeOut(function() {
      $(this).remove();
    });
  } else {
    if($(this).attr('status')=='new') { // new group
      track('Sugar', 'Create a group', 'Create a group with mousedown', true);
      // visual
      $('.title', this).show();
      // db
      var group = new SugarGroup({
        id: SugarGroup.next_index(),
        name: title,
        posX: x,
        posY: y,
        width: w,
        height: h
      });
      group.db_insert({
        success: function(rs) {
          // add it to the group list
          //back.groups.push( group );
          back.updateUI(true);
          // keep references between the group object and the group UI
          $(this).attr('id', 'group-'+group.id);
          // change the status of the group ui
          $(this).attr('status', 'update');
        }
      });
    } else { // existing group
      var group = new SugarGroup({id: id});
      group.db_update({
        key: 'width',
        val: w,
        success: function(rs) {
          group.db_update({
            key: 'height',
            val: h,
            success: function(rs) {
              group.db_update({
                key: 'posX',
                val: x,
                success: function(rs) {
                  group.db_update({
                    key: 'posY',
                    val: y,
                    success: function(rs) {}
                  });
                }
              });
            }
          });
        }
      });
    }
  }
}